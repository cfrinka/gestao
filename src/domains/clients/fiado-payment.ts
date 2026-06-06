import { adminDb } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { FiadoPayment, Order, PaymentMethod } from "@/lib/db-types";
import { convertTimestamp } from "@/domains/shared/firestore-serializers";

function toCompetencyMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

async function assertFinancialMonthOpen(date: Date): Promise<void> {
  const month = toCompetencyMonth(date);
  const closure = await adminDb.collection("financialClosures").doc(month).get();
  if (closure.exists) {
    throw new Error(`Financial month ${month} is already closed`);
  }
}

function mapOrderPaymentMethodToFinancial(method: PaymentMethod["method"]): "cash" | "pix" | "credit" | "debit" {
  if (method === "DINHEIRO") return "cash";
  if (method === "PIX") return "pix";
  if (method === "CREDITO") return "credit";
  return "debit";
}

function mapOrderPaymentMethodToCashRegisterField(
  method: PaymentMethod["method"]
): "totalCash" | "totalPix" | "totalCredit" | "totalDebit" {
  if (method === "DINHEIRO") return "totalCash";
  if (method === "PIX") return "totalPix";
  if (method === "CREDITO") return "totalCredit";
  return "totalDebit";
}

interface PaymentAllocation {
  orderId: string;
  orderDate: string;
  orderTotalAmount: number;
  remainingBefore: number;
  appliedAmount: number;
  remainingAfter: number;
  isFullyPaid: boolean;
}

interface FiadoPaymentResult {
  allocations: PaymentAllocation[];
  totalApplied: number;
  overpayment: number;
}

export async function applyCascadingFiadoPayment(
  clientId: string,
  paymentAmount: number,
  method: PaymentMethod["method"],
  receivedByUserId?: string
): Promise<FiadoPaymentResult> {
  if (!paymentAmount || paymentAmount <= 0) {
    throw new Error("Payment amount must be greater than zero");
  }

  const clientRef = adminDb.collection("clients").doc(clientId);
  const now = new Date();
  await assertFinancialMonthOpen(now);
  const nowTs = Timestamp.fromDate(now);

  const result: FiadoPaymentResult = {
    allocations: [],
    totalApplied: 0,
    overpayment: 0,
  };

  let remainingToApply = paymentAmount;

  const safeReceivedByUserId = String(receivedByUserId || "").trim();

  await adminDb.runTransaction(async (tx) => {
    // ===== ALL READS FIRST =====
    const clientSnap = await tx.get(clientRef);
    if (!clientSnap.exists) {
      throw new Error("Client not found");
    }
    const clientName = String(clientSnap.data()?.name || "Cliente").trim();

    const ordersQuery = adminDb
      .collection("orders")
      .where("clientId", "==", clientId)
      .where("isPaidLater", "==", true);
    const ordersSnap = await tx.get(ordersQuery);

    if (ordersSnap.empty) {
      throw new Error("No pending fiado orders found");
    }

    // Read cash register upfront if needed
    let registerDoc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData> | null = null;
    if (safeReceivedByUserId) {
      const openRegisterQuery = adminDb
        .collection("cashRegisters")
        .where("userId", "==", safeReceivedByUserId)
        .where("status", "==", "OPEN")
        .limit(1);
      const openRegisterSnapshot = await tx.get(openRegisterQuery);
      if (!openRegisterSnapshot.empty) {
        registerDoc = openRegisterSnapshot.docs[0];
      }
    }

    // ===== PROCESS DATA =====
    const sortedOrderDocs = ordersSnap.docs
      .map((doc) => ({ doc, data: convertTimestamp<Order>(doc.data()!) }))
      .filter(({ data }) => data.isCancelled !== true)
      .sort((a, b) => {
        const dateA = a.data.createdAt ? new Date(a.data.createdAt).getTime() : 0;
        const dateB = b.data.createdAt ? new Date(b.data.createdAt).getTime() : 0;
        return dateA - dateB;
      });

    let totalClientBalanceReduction = 0;

    for (const { doc: orderDoc, data: order } of sortedOrderDocs) {
      if (remainingToApply <= 0) break;

      const currentRemaining = typeof order.remainingAmount === "number" ? order.remainingAmount : order.totalAmount;
      if (currentRemaining <= 0) continue;

      const appliedToOrder = Math.min(remainingToApply, currentRemaining);
      const newRemaining = currentRemaining - appliedToOrder;
      const isFullyPaid = newRemaining <= 0;
      const orderDate = order.createdAt instanceof Date ? order.createdAt : new Date();
      const orderDateStr = orderDate.toLocaleDateString("pt-BR");

      const currentPaid = typeof order.amountPaid === "number" ? order.amountPaid : 0;
      const newPaid = currentPaid + appliedToOrder;

      const payment: Omit<FiadoPayment, "createdAt"> & { createdAt: Timestamp } = {
        id: `pay_${Date.now()}_${orderDoc.id}`,
        amount: appliedToOrder,
        method,
        createdAt: nowTs,
      };

      // Queue order write
      tx.update(orderDoc.ref, {
        amountPaid: newPaid,
        remainingAmount: newRemaining,
        paymentHistory: FieldValue.arrayUnion(payment),
        ...(isFullyPaid ? { paidAt: nowTs } : {}),
      });

      result.allocations.push({
        orderId: orderDoc.id,
        orderDate: orderDateStr,
        orderTotalAmount: order.totalAmount,
        remainingBefore: currentRemaining,
        appliedAmount: appliedToOrder,
        remainingAfter: newRemaining,
        isFullyPaid,
      });

      totalClientBalanceReduction += appliedToOrder;
      remainingToApply -= appliedToOrder;
      result.totalApplied += appliedToOrder;
    }

    // ===== ALL WRITES AFTER ALL READS =====
    tx.update(clientRef, {
      balance: FieldValue.increment(-totalClientBalanceReduction),
      updatedAt: nowTs,
    });

    const cashRegisterId = registerDoc ? registerDoc.id : null;
    if (registerDoc) {
      const paymentField = mapOrderPaymentMethodToCashRegisterField(method);
      tx.update(registerDoc.ref, {
        totalSales: FieldValue.increment(result.totalApplied),
        [paymentField]: FieldValue.increment(result.totalApplied),
        salesCount: FieldValue.increment(result.allocations.length),
      });
    }

    for (const allocation of result.allocations) {
      const movementRef = adminDb.collection("financialMovements").doc();
      const description = allocation.isFullyPaid
        ? `Pagamento completo compra ${allocation.orderDate} de ${clientName}`
        : `Pagamento parcial compra ${allocation.orderDate} de ${clientName}`;

      tx.set(movementRef, {
        type: "FIADO_PAYMENT",
        direction: "IN",
        amount: allocation.appliedAmount,
        paymentMethod: mapOrderPaymentMethodToFinancial(method),
        relatedEntity: { kind: "order", id: allocation.orderId },
        occurredAt: nowTs,
        competencyMonth: nowTs.toDate().toISOString().slice(0, 7),
        createdBy: clientId,
        metadata: {
          clientId,
          clientName,
          description,
          orderDate: allocation.orderDate,
          orderId: allocation.orderId,
          isFullPayment: allocation.isFullyPaid,
          remainingBefore: allocation.remainingBefore,
          remainingAfter: allocation.remainingAfter,
          receivedByUserId: safeReceivedByUserId || null,
          cashRegisterId,
        },
      });
    }

    result.overpayment = Math.max(0, remainingToApply);
  });

  return result;
}
