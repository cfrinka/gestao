import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { Order, OrderItem } from "@/lib/db-types";
import { convertTimestamp } from "@/domains/shared/firestore-serializers";

function mapOrderPaymentMethodToFinancial(method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"): "cash" | "pix" | "credit" | "debit" {
  if (method === "DINHEIRO") return "cash";
  if (method === "PIX") return "pix";
  if (method === "CREDITO") return "credit";
  return "debit";
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

  const normalizedPayments = input.payments
    .map((payment) => ({
      method: payment.method,
      amount: Number(payment.amount || 0),
    }))
    .filter((payment) => Number.isFinite(payment.amount) && payment.amount > 0);

  const orderRef = adminDb.collection("orders").doc(input.orderId);

  return adminDb.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw new Error("Order not found");
    }

    const order = convertTimestamp<Order>(orderSnap.data()!);
    if (order.isPaidLater) {
      throw new Error("Fiado sales cannot be edited in this screen");
    }

    const itemsQuery = adminDb.collection("orderItems").where("orderId", "==", input.orderId);
    const itemsSnapshot = await tx.get(itemsQuery);
    const items = itemsSnapshot.docs.map((itemDoc) => ({
      id: itemDoc.id,
      ...itemDoc.data(),
    })) as OrderItem[];

    const subtotal = items.reduce((sum, item) => sum + Number(item.totalRevenue || 0), 0);
    if (safeDiscount > subtotal) {
      throw new Error("Discount cannot be greater than subtotal");
    }

    const nextTotalAmount = Math.max(0, subtotal - safeDiscount);
    const totalPaid = normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0);
    if (Math.abs(totalPaid - nextTotalAmount) > 0.01) {
      throw new Error("Payment total must match order total");
    }

    const now = new Date();
    const nowTs = Timestamp.fromDate(now);

    tx.update(orderRef, {
      discount: safeDiscount,
      totalAmount: nextTotalAmount,
      payments: normalizedPayments,
      updatedAt: nowTs,
    });

    const saleMovementQuery = adminDb
      .collection("financialMovements")
      .where("type", "==", "SALE_REVENUE")
      .where("relatedEntity.id", "==", input.orderId)
      .limit(1);
    const saleMovementSnapshot = await tx.get(saleMovementQuery);
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

    const orderCreatedAt = order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt);
    const registerQuery = adminDb
      .collection("cashRegisters")
      .where("openedAt", "<=", Timestamp.fromDate(orderCreatedAt))
      .orderBy("openedAt", "desc")
      .limit(10);
    const registerSnapshot = await tx.get(registerQuery);
    const matchingRegister = registerSnapshot.docs.find((doc) => {
      const data = doc.data();
      const closedAt = data.closedAt && typeof data.closedAt.toDate === "function" ? data.closedAt.toDate() : null;
      return !closedAt || closedAt.getTime() >= orderCreatedAt.getTime();
    });

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
