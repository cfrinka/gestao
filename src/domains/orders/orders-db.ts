import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { Order, OrderItem } from "@/lib/db-types";
import { convertTimestamp } from "@/domains/shared/firestore-serializers";

function normalizePositivePayments(
  payments: Array<{ method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"; amount: number }>
): Array<{ method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"; amount: number }> {
  return payments
    .map((payment) => ({
      method: payment.method,
      amount: Number(payment.amount || 0),
    }))
    .filter((payment) => Number.isFinite(payment.amount) && payment.amount > 0);
}

async function findMatchingCashRegister(
  tx: FirebaseFirestore.Transaction,
  orderCreatedAt: Date
): Promise<FirebaseFirestore.QueryDocumentSnapshot | undefined> {
  const registerQuery = adminDb
    .collection("cashRegisters")
    .where("openedAt", "<=", Timestamp.fromDate(orderCreatedAt))
    .orderBy("openedAt", "desc")
    .limit(10);
  const registerSnapshot = await tx.get(registerQuery);
  return registerSnapshot.docs.find((doc) => {
    const data = doc.data();
    const closedAt = data.closedAt && typeof data.closedAt.toDate === "function" ? data.closedAt.toDate() : null;
    return !closedAt || closedAt.getTime() >= orderCreatedAt.getTime();
  });
}

function mapOrderPaymentMethodToFinancial(method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"): "cash" | "pix" | "credit" | "debit" {
  if (method === "DINHEIRO") return "cash";
  if (method === "PIX") return "pix";
  if (method === "CREDITO") return "credit";
  return "debit";
}

function toCompetencyMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export async function cancelOrder(input: {
  orderId: string;
  actorId: string;
  actorRole: string;
  reason?: string;
}): Promise<Order> {
  if (input.actorRole !== "ADMIN") {
    throw new Error("Only admins can cancel sales");
  }

  const safeReason = String(input.reason || "").trim();
  const orderRef = adminDb.collection("orders").doc(input.orderId);

  return adminDb.runTransaction(async (tx) => {
    // ── ALL READS FIRST ──
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw new Error("Order not found");
    }

    const order = convertTimestamp<Order>(orderSnap.data()!);
    if (order.isCancelled) {
      throw new Error("Order is already cancelled");
    }
    if (order.isPaidLater) {
      throw new Error("Fiado sales cannot be cancelled in this screen");
    }

    // Get order items to restore stock
    const itemsQuery = adminDb.collection("orderItems").where("orderId", "==", input.orderId);
    const itemsSnapshot = await tx.get(itemsQuery);
    const items = itemsSnapshot.docs.map((itemDoc) => ({
      id: itemDoc.id,
      ...itemDoc.data(),
    })) as OrderItem[];

    // Get product documents for stock restoration
    const productRefs = new Map<string, FirebaseFirestore.DocumentReference>();
    const productData = new Map<string, any>();
    for (const item of items) {
      if (!productRefs.has(item.productId)) {
        const productRef = adminDb.collection("products").doc(item.productId);
        productRefs.set(item.productId, productRef);
        const productSnap = await tx.get(productRef);
        if (productSnap.exists) {
          productData.set(item.productId, productSnap.data());
        }
      }
    }

    const saleMovementQuery = adminDb
      .collection("financialMovements")
      .where("type", "==", "SALE_REVENUE")
      .where("relatedEntity.id", "==", input.orderId)
      .limit(1);
    const saleMovementSnapshot = await tx.get(saleMovementQuery);

    const cogsMovementQuery = adminDb
      .collection("financialMovements")
      .where("type", "==", "COGS")
      .where("relatedEntity.id", "==", input.orderId)
      .limit(1);
    const cogsMovementSnapshot = await tx.get(cogsMovementQuery);

    const orderCreatedAt = order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt);
    const matchingRegister = await findMatchingCashRegister(tx, orderCreatedAt);

    // Cancelling would zero out this order's SALE_REVENUE/COGS movements — if its
    // competency month is already closed, that would silently diverge the frozen
    // financialClosures snapshot from the live movements. Block it instead, matching
    // how every other financial write in the app treats a closed month.
    const orderMonth = toCompetencyMonth(orderCreatedAt);
    const closureSnap = await tx.get(adminDb.collection("financialClosures").doc(orderMonth));
    if (closureSnap.exists) {
      throw new Error(`Financial month ${orderMonth} is closed`);
    }

    // ── ALL WRITES AFTER ──
    const now = new Date();
    const nowTs = Timestamp.fromDate(now);
    const currentTotal = Math.max(0, Number(order.totalAmount || 0));
    const currentPayments = normalizePositivePayments((order.payments || []) as Array<{
      method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX";
      amount: number;
    }>);

    // Restore stock for each item
    for (const item of items) {
      const productRef = productRefs.get(item.productId);
      const product = productData.get(item.productId);
      
      if (productRef && product) {
        const quantity = Number(item.quantity || 0);
        const size = String(item.size || "").trim();
        const sizes = Array.isArray(product.sizes) ? product.sizes : [];
        
        if (size && sizes.length > 0) {
          // Product with sizes - restore to specific size
          const sizeIndex = sizes.findIndex((s: any) => s.size === size);
          if (sizeIndex >= 0) {
            const updatedSizes = sizes.map((s: any, idx: number) =>
              idx === sizeIndex ? { ...s, stock: Number(s.stock || 0) + quantity } : s
            );
            // Recalculate total stock from sizes
            const newStock = updatedSizes.reduce((sum: number, s: any) => sum + Number(s.stock || 0), 0);
            tx.update(productRef, {
              stock: newStock,
              sizes: updatedSizes,
              updatedAt: nowTs,
            });
          }
        } else {
          // Product without sizes - restore to total stock
          tx.update(productRef, {
            stock: FieldValue.increment(quantity),
            updatedAt: nowTs,
          });
        }
      }
    }

    tx.update(orderRef, {
      isCancelled: true,
      cancelledAt: nowTs,
      cancelledBy: input.actorId,
      cancellationReason: safeReason || "Sem motivo informado",
      updatedAt: nowTs,
    });

    if (!saleMovementSnapshot.empty) {
      tx.update(saleMovementSnapshot.docs[0].ref, {
        amount: 0,
        metadata: {
          ...(saleMovementSnapshot.docs[0].data().metadata || {}),
          cancelled: true,
          cancelledAt: nowTs,
          cancelledBy: input.actorId,
          cancellationReason: safeReason || "Sem motivo informado",
        },
      });
    }

    if (!cogsMovementSnapshot.empty) {
      tx.update(cogsMovementSnapshot.docs[0].ref, {
        amount: 0,
        metadata: {
          ...(cogsMovementSnapshot.docs[0].data().metadata || {}),
          cancelled: true,
          cancelledAt: nowTs,
          cancelledBy: input.actorId,
        },
      });
    }

    // A CLOSED register has already been reconciled and reported on — its totals are a
    // frozen record of what was physically counted that day. Only an OPEN register's
    // running totals are safe to adjust; a cancellation against an already-closed
    // register is still recorded (via the audit log below) but doesn't rewrite it.
    const registerStatus = matchingRegister?.data()?.status;
    const canAdjustRegister = Boolean(matchingRegister) && registerStatus === "OPEN";

    if (canAdjustRegister && matchingRegister && currentTotal > 0) {
      const currentByMethod = paymentAmountByMethod(currentPayments);
      tx.update(matchingRegister.ref, {
        totalSales: FieldValue.increment(-currentTotal),
        totalCash: FieldValue.increment(-currentByMethod.DINHEIRO),
        totalDebit: FieldValue.increment(-currentByMethod.DEBITO),
        totalCredit: FieldValue.increment(-currentByMethod.CREDITO),
        totalPix: FieldValue.increment(-currentByMethod.PIX),
        salesCount: FieldValue.increment(-1),
      });
    }

    const auditRef = adminDb.collection("financialAuditLogs").doc();
    tx.set(auditRef, {
      action: "ORDER_CANCELLATION",
      actorId: input.actorId,
      actorRole: input.actorRole,
      occurredAt: nowTs,
      relatedEntity: { kind: "order", id: input.orderId },
      payload: {
        reason: safeReason || "Sem motivo informado",
        originalTotalAmount: currentTotal,
        originalPayments: currentPayments,
        matchingRegisterId: matchingRegister?.id || null,
        registerAdjusted: canAdjustRegister,
        registerAlreadyClosed: Boolean(matchingRegister) && !canAdjustRegister,
      },
    });

    return {
      ...order,
      id: input.orderId,
      items,
      isCancelled: true,
      cancelledAt: now,
      cancelledBy: input.actorId,
      cancellationReason: safeReason || "Sem motivo informado",
    };
  });
}

function paymentAmountByMethod(
  payments: Array<{ method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"; amount: number }>
): Record<"DINHEIRO" | "DEBITO" | "CREDITO" | "PIX", number> {
  return {
    DINHEIRO: payments.find((p) => p.method === "DINHEIRO")?.amount || 0,
    DEBITO: payments.find((p) => p.method === "DEBITO")?.amount || 0,
    CREDITO: payments.find((p) => p.method === "CREDITO")?.amount || 0,
    PIX: payments.find((p) => p.method === "PIX")?.amount || 0,
  };
}

export async function updateOrder(input: {
  orderId: string;
  discount: number;
  payments: Array<{ method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"; amount: number }>;
  actorId: string;
  actorRole: string;
}): Promise<Order> {
  if (input.actorRole !== "ADMIN") {
    throw new Error("Only admins can edit sales");
  }

  const safeDiscount = Number(input.discount || 0);
  if (!Number.isFinite(safeDiscount) || safeDiscount < 0) {
    throw new Error("Discount must be a valid non-negative number");
  }

  const normalizedPayments = normalizePositivePayments(input.payments);

  const orderRef = adminDb.collection("orders").doc(input.orderId);

  return adminDb.runTransaction(async (tx) => {
    // ── ALL READS FIRST ──
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw new Error("Order not found");
    }

    const order = convertTimestamp<Order>(orderSnap.data()!);
    if (order.isCancelled) {
      throw new Error("Cancelled sales cannot be edited");
    }
    if (order.isPaidLater) {
      throw new Error("Fiado sales cannot be edited in this screen");
    }

    const itemsQuery = adminDb.collection("orderItems").where("orderId", "==", input.orderId);
    const itemsSnapshot = await tx.get(itemsQuery);
    const items = itemsSnapshot.docs.map((itemDoc) => ({
      id: itemDoc.id,
      ...itemDoc.data(),
    })) as OrderItem[];

    const saleMovementQuery = adminDb
      .collection("financialMovements")
      .where("type", "==", "SALE_REVENUE")
      .where("relatedEntity.id", "==", input.orderId)
      .limit(1);
    const saleMovementSnapshot = await tx.get(saleMovementQuery);

    const orderCreatedAt = order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt);
    const matchingRegister = await findMatchingCashRegister(tx, orderCreatedAt);

    // Editing would change this order's SALE_REVENUE movement — block it for a
    // closed competency month so the frozen financialClosures snapshot can't diverge.
    const orderMonth = toCompetencyMonth(orderCreatedAt);
    const closureSnap = await tx.get(adminDb.collection("financialClosures").doc(orderMonth));
    if (closureSnap.exists) {
      throw new Error(`Financial month ${orderMonth} is closed`);
    }

    // ── VALIDATION ──
    const subtotal = items.reduce((sum, item) => sum + Number(item.totalRevenue || 0), 0);
    if (safeDiscount > subtotal) {
      throw new Error("Discount cannot be greater than subtotal");
    }

    const nextTotalAmount = Math.max(0, subtotal - safeDiscount);
    const totalPaid = normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0);
    if (Math.abs(totalPaid - nextTotalAmount) > 0.01) {
      throw new Error("Payment total must match order total");
    }

    // ── ALL WRITES AFTER ──
    const now = new Date();
    const nowTs = Timestamp.fromDate(now);

    tx.update(orderRef, {
      discount: safeDiscount,
      totalAmount: nextTotalAmount,
      payments: normalizedPayments,
      updatedAt: nowTs,
    });

    if (!saleMovementSnapshot.empty) {
      const saleMovementRef = saleMovementSnapshot.docs[0].ref;
      tx.update(saleMovementRef, {
        amount: nextTotalAmount,
        metadata: {
          subtotal,
          discount: safeDiscount,
          isPaidLater: false,
          payments: normalizedPayments.map((payment) => ({
            method: mapOrderPaymentMethodToFinancial(payment.method),
            amount: Number(payment.amount || 0),
          })),
          updatedBy: input.actorId,
          updatedAt: nowTs,
        },
      });
    }

    if (matchingRegister) {
      const previousByMethod = paymentAmountByMethod((order.payments || []) as Array<{
        method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX";
        amount: number;
      }>);
      const nextByMethod = paymentAmountByMethod(normalizedPayments);
      const previousTotal = Number(order.totalAmount || 0);
      const totalDelta = nextTotalAmount - previousTotal;

      tx.update(matchingRegister.ref, {
        totalSales: FieldValue.increment(totalDelta),
        totalCash: FieldValue.increment(nextByMethod.DINHEIRO - previousByMethod.DINHEIRO),
        totalDebit: FieldValue.increment(nextByMethod.DEBITO - previousByMethod.DEBITO),
        totalCredit: FieldValue.increment(nextByMethod.CREDITO - previousByMethod.CREDITO),
        totalPix: FieldValue.increment(nextByMethod.PIX - previousByMethod.PIX),
      });
    }

    return {
      ...order,
      discount: safeDiscount,
      totalAmount: nextTotalAmount,
      payments: normalizedPayments,
      items,
    };
  });
}

export async function getOrders(startDate?: Date, endDate?: Date): Promise<Order[]> {
  let query: FirebaseFirestore.Query = adminDb.collection("orders").orderBy("createdAt", "desc");

  if (startDate && endDate) {
    query = adminDb
      .collection("orders")
      .where("createdAt", ">=", Timestamp.fromDate(startDate))
      .where("createdAt", "<=", Timestamp.fromDate(endDate))
      .orderBy("createdAt", "desc");
  }

  const ordersSnapshot = await query.get();
  const orders: Order[] = [];

  for (const orderDoc of ordersSnapshot.docs) {
    const orderData = convertTimestamp<Omit<Order, "id">>(orderDoc.data());

    const itemsSnapshot = await adminDb.collection("orderItems").where("orderId", "==", orderDoc.id).get();

    const items = itemsSnapshot.docs.map((itemDoc) => ({
      id: itemDoc.id,
      ...itemDoc.data(),
    })) as OrderItem[];

    orders.push({
      id: orderDoc.id,
      ...orderData,
      items,
    });
  }

  return orders;
}
