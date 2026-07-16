import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { SyncResult, UserCommission } from "@/domains/comission/types";

const COMMISSION_RATE = 0.03;

function toCompetencyMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function mapOrderPaymentMethod(method: string): "cash" | "pix" | "credit" | "debit" {
  if (method === "DINHEIRO") return "cash";
  if (method === "PIX") return "pix";
  if (method === "CREDITO") return "credit";
  return "debit";
}

/**
 * Reconciliation job: backfills a SALE_REVENUE movement for any order that doesn't have one
 * yet, and fixes createdBy on movements that were stamped "unknown"/"system". Naturally
 * idempotent — re-running it is a no-op for orders/movements already in a good state, since
 * it only acts on orders whose id isn't already present among existing SALE_REVENUE
 * movements' relatedEntity.
 */
export async function syncCommissionMovements(): Promise<SyncResult> {
  // 1. Fetch all orders (filter cancelled in JS because Firestore != skips docs without the field)
  const ordersSnap = await adminDb.collection("orders").get();

  // 2. Fetch all existing SALE_REVENUE movements and all cashRegisters
  const [movementsSnap, registersSnap] = await Promise.all([
    adminDb.collection("financialMovements").where("type", "==", "SALE_REVENUE").get(),
    adminDb.collection("cashRegisters").get(),
  ]);

  // Build cashRegister time ranges for legacy order user inference
  const registerRanges = registersSnap.docs
    .map((doc) => {
      const d = doc.data();
      const openedAt = d.openedAt?.toDate ? d.openedAt.toDate() : new Date(d.openedAt || 0);
      const closedAt = d.closedAt?.toDate ? d.closedAt.toDate() : null;
      return {
        userId: String(d.userId || ""),
        userName: String(d.userName || ""),
        openedAt: openedAt.getTime(),
        closedAt: closedAt ? closedAt.getTime() : Infinity,
      };
    })
    .filter((r) => r.userId.length > 0);

  const existingOrderIds = new Set<string>();
  const createdByFromMovement = new Map<string, string>();
  for (const doc of movementsSnap.docs) {
    const data = doc.data();
    const related = data?.relatedEntity;
    if (related?.kind === "order" && related?.id) {
      existingOrderIds.add(related.id);
      if (data?.createdBy) {
        createdByFromMovement.set(related.id, String(data.createdBy));
      }
    }
  }

  // 3. Fix existing movements with unknown/system createdBy FIRST
  // (so it runs even when no new orders need syncing)
  const fixableMovements = movementsSnap.docs.filter((doc) => {
    const data = doc.data();
    const createdBy = String(data?.createdBy || "");
    return createdBy === "unknown" || createdBy === "system";
  });

  let fixedCount = 0;
  if (fixableMovements.length > 0) {
    const fixBatch = adminDb.batch();
    for (const movementDoc of fixableMovements) {
      const movementData = movementDoc.data();
      const related = movementData?.relatedEntity;
      if (!related || related.kind !== "order" || !related.id) continue;

      const orderDoc = ordersSnap.docs.find((d) => d.id === related.id);
      if (!orderDoc) continue;

      const orderData = orderDoc.data();
      let fixedCreatedBy =
        String(orderData?.createdById || orderData?.createdBy || orderData?.userId || orderData?.uid || "");

      if (!fixedCreatedBy) {
        const createdAtRaw = orderData.createdAt;
        const orderTs = createdAtRaw?.toDate ? createdAtRaw.toDate().getTime() : new Date(createdAtRaw || 0).getTime();
        const matchingRegister = registerRanges.find((r) => orderTs >= r.openedAt && orderTs <= r.closedAt);
        fixedCreatedBy = matchingRegister ? matchingRegister.userId : "";
      }

      if (fixedCreatedBy) {
        fixBatch.update(movementDoc.ref, { createdBy: fixedCreatedBy });
        fixedCount++;
      }
    }
    await fixBatch.commit();
  }

  // 4. Collect new orders to sync
  const ordersToSync: Array<{
    id: string;
    data: FirebaseFirestore.DocumentData;
    createdBy: string;
  }> = [];

  for (const doc of ordersSnap.docs) {
    const data = doc.data();
    if (data.isCancelled === true) continue;
    if (existingOrderIds.has(doc.id)) continue;

    let createdBy =
      String(data?.createdById || data?.createdBy || data?.userId || data?.uid || createdByFromMovement.get(doc.id) || "");

    if (!createdBy) {
      const createdAtRaw = data.createdAt;
      const orderTs = createdAtRaw?.toDate ? createdAtRaw.toDate().getTime() : new Date(createdAtRaw || 0).getTime();
      const matchingRegister = registerRanges.find((r) => orderTs >= r.openedAt && orderTs <= r.closedAt);
      createdBy = matchingRegister ? matchingRegister.userId : "system";
    }

    ordersToSync.push({ id: doc.id, data, createdBy });
  }

  // 5. Create missing movements in batches (Firestore limit: 500 ops/batch)
  let syncedCount = 0;
  if (ordersToSync.length > 0) {
    const BATCH_LIMIT = 499;
    for (let i = 0; i < ordersToSync.length; i += BATCH_LIMIT) {
      const batch = adminDb.batch();
      const chunk = ordersToSync.slice(i, i + BATCH_LIMIT);

      for (const order of chunk) {
        const createdAtRaw = order.data.createdAt;
        const createdAtDate = createdAtRaw?.toDate ? createdAtRaw.toDate() : new Date(createdAtRaw || Date.now());
        const competencyMonth = toCompetencyMonth(createdAtDate);
        const createdAtTs = Timestamp.fromDate(createdAtDate);

        const totalAmount = Number(order.data.totalAmount || 0);
        const subtotal = Number(order.data.subtotal || totalAmount);
        const discount = Number(order.data.discount || 0);
        const isPaidLater = Boolean(order.data.isPaidLater);
        const payments = Array.isArray(order.data.payments) ? order.data.payments : [];

        const movementRef = adminDb.collection("financialMovements").doc();
        batch.set(movementRef, {
          type: "SALE_REVENUE",
          direction: "IN",
          amount: totalAmount,
          relatedEntity: { kind: "order", id: order.id },
          occurredAt: createdAtTs,
          competencyMonth,
          createdBy: order.createdBy,
          metadata: {
            subtotal,
            discount,
            isPaidLater,
            payments: payments.map((p: { method?: string; amount?: number }) => ({
              method: mapOrderPaymentMethod(String(p.method || "DEBITO")),
              amount: Number(p.amount || 0),
            })),
          },
        });
      }

      await batch.commit();
      syncedCount += chunk.length;
    }
  }

  if (syncedCount === 0 && fixedCount === 0) {
    return { synced: 0, fixed: 0, message: "Nenhuma venda pendente de sincronização." };
  }

  return {
    synced: syncedCount,
    fixed: fixedCount,
    message: `${syncedCount} venda(s) sincronizada(s).` + (fixedCount > 0 ? ` ${fixedCount} registro(s) corrigido(s).` : ""),
  };
}

export async function getCommissionReport(targetUserId: string | null): Promise<UserCommission[]> {
  // Fetch all users (active and inactive) so old sales from deactivated users still show names
  const usersSnap = await adminDb.collection("users").get();
  const users = usersSnap.docs.map((doc) => ({
    id: doc.id,
    name: String(doc.data()?.name || ""),
    role: String(doc.data()?.role || "CASHIER"),
  }));

  const userMap = new Map(users.map((u) => [u.id, u]));

  let movementsQuery: FirebaseFirestore.Query = adminDb.collection("financialMovements").where("type", "==", "SALE_REVENUE");
  if (targetUserId) {
    movementsQuery = movementsQuery.where("createdBy", "==", targetUserId);
  }

  const movementsSnap = await movementsQuery.get();

  // Group by userId -> month -> totalSales
  const salesByUserMonth: Record<string, Record<string, number>> = {};

  for (const doc of movementsSnap.docs) {
    const data = doc.data();
    const userId = String(data?.createdBy || "");
    const amount = Number(data?.amount || 0);
    const month = String(data?.competencyMonth || "");
    const createdAt = data?.occurredAt;
    const effectiveMonth = month || (createdAt ? new Date(createdAt.toDate()).toISOString().slice(0, 7) : "");

    if (!userId || !effectiveMonth) continue;

    if (!salesByUserMonth[userId]) {
      salesByUserMonth[userId] = {};
    }
    salesByUserMonth[userId][effectiveMonth] = (salesByUserMonth[userId][effectiveMonth] || 0) + amount;
  }

  const result: UserCommission[] = [];

  for (const userId of Object.keys(salesByUserMonth)) {
    let userInfo = userMap.get(userId);
    if (!userInfo) {
      userMap.set(userId, { id: userId, name: "Usuário Desconhecido", role: "CASHIER" });
      userInfo = userMap.get(userId)!;
    }

    const monthMap = salesByUserMonth[userId];
    const months = Object.entries(monthMap)
      .sort((a, b) => b[0].localeCompare(a[0])) // Descending month
      .map(([month, totalSales]) => ({
        month,
        totalSales,
        commission: Math.round(totalSales * COMMISSION_RATE * 100) / 100,
      }));

    const totalSalesOverall = months.reduce((sum, m) => sum + m.totalSales, 0);
    const totalCommission = months.reduce((sum, m) => sum + m.commission, 0);

    result.push({
      userId,
      userName: userInfo.name || userId,
      role: userInfo.role,
      months,
      totalSalesOverall,
      totalCommission,
    });
  }

  // Sort by total sales descending
  result.sort((a, b) => b.totalSalesOverall - a.totalSalesOverall);

  return result;
}
