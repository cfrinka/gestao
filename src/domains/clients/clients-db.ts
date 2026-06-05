import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { Client, FiadoPayment, Order, OrderItem, PaymentMethod } from "@/lib/db-types";
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
    throw new Error(`Financial month ${month} is closed`);
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

export async function getClients(): Promise<Client[]> {
  const snapshot = await adminDb.collection("clients").orderBy("name").get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamp<Omit<Client, "id">>(doc.data()),
  }));
}

export async function getClient(id: string): Promise<Client | null> {
  const doc = await adminDb.collection("clients").doc(id).get();
  if (!doc.exists) return null;
  return {
    id: doc.id,
    ...convertTimestamp<Omit<Client, "id">>(doc.data()!),
  };
}

export async function createClient(
  data: Omit<Client, "id" | "createdAt" | "updatedAt" | "balance">
): Promise<Client> {
  const now = new Date();
  const docRef = await adminDb.collection("clients").add({
    ...data,
    balance: 0,
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  });
  return { id: docRef.id, ...data, balance: 0, createdAt: now, updatedAt: now };
}

export async function updateClient(
  id: string,
  data: Partial<Omit<Client, "id" | "createdAt" | "updatedAt">>
): Promise<void> {
  await adminDb.collection("clients").doc(id).update({
    ...data,
    updatedAt: Timestamp.fromDate(new Date()),
  });
}

export async function updateClientBalance(id: string, amount: number): Promise<void> {
  await adminDb.collection("clients").doc(id).update({
    balance: FieldValue.increment(amount),
    updatedAt: Timestamp.fromDate(new Date()),
  });
}

export async function deleteClient(id: string): Promise<void> {
  await adminDb.collection("clients").doc(id).delete();
}

export async function getClientPendingOrders(clientId: string): Promise<Order[]> {
  const snapshot = await adminDb
    .collection("orders")
    .where("clientId", "==", clientId)
    .where("isPaidLater", "==", true)
    .get();

  const orders = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamp<Omit<Order, "id">>(doc.data()),
  }));

  const pendingOrders = orders.filter((order) => {
    if (typeof order.remainingAmount === "number") return order.remainingAmount > 0;
    return true;
  });

  return Promise.all(
    pendingOrders.map(async (order) => {
      const itemsSnapshot = await adminDb.collection("orderItems").where("orderId", "==", order.id).get();

      const itemsWithProductName = await Promise.all(
        itemsSnapshot.docs.map(async (itemDoc) => {
          const itemData = convertTimestamp<Omit<OrderItem, "id">>(itemDoc.data());

          const productDoc = await adminDb.collection("products").doc(itemData.productId).get();
          const productName = productDoc.exists
            ? String(productDoc.data()?.name || "Produto removido")
            : "Produto removido";

          return {
            id: itemDoc.id,
            ...itemData,
            productName,
          };
        })
      );

      const paymentHistory: FiadoPayment[] = Array.isArray(order.paymentHistory)
        ? (order.paymentHistory as unknown as Array<{ id: string; amount: number; method: PaymentMethod["method"]; createdAt: unknown }>).map((entry) => ({
            id: entry.id,
            amount: entry.amount,
            method: entry.method,
            createdAt:
              entry.createdAt && typeof entry.createdAt === "object" && "toDate" in (entry.createdAt as object)
                ? (entry.createdAt as { toDate: () => Date }).toDate()
                : new Date(String(entry.createdAt || "")),
          }))
        : [];

      return {
        ...order,
        items: itemsWithProductName,
        paymentHistory,
      };
    })
  );
}

export async function markOrderAsPaid(orderId: string): Promise<void> {
  await adminDb.collection("orders").doc(orderId).update({
    paidAt: Timestamp.fromDate(new Date()),
  });
}

export async function applyCascadingFiadoPayment(
  clientId: string,
  paymentAmount: number,
  method: PaymentMethod["method"],
  receivedByUserId?: string
) {
  const { applyCascadingFiadoPayment: applyCascadingPayment } = await import("./fiado-payment");
  return applyCascadingPayment(clientId, paymentAmount, method, receivedByUserId);
}

export async function correctClientDebt(
  clientId: string,
  correctionAmount: number,
  adminPassword: string,
  reason: string
): Promise<void> {
  if (!correctionAmount || correctionAmount === 0) {
    throw new Error("Correction amount must be different from zero");
  }
  
  if (!reason || reason.trim().length === 0) {
    throw new Error("Reason for correction is required");
  }

  // Verify admin password
  const settingsDoc = await adminDb.collection("settings").doc("general").get();
  const settings = settingsDoc.data();
  if (!settings || settings.adminPassword !== adminPassword) {
    throw new Error("Invalid admin password");
  }

  const clientRef = adminDb.collection("clients").doc(clientId);
  const now = new Date();
  const nowTs = Timestamp.fromDate(now);

  // Build the orders query outside the transaction (equality filters only, no composite index needed)
  const ordersQuery = adminDb
    .collection("orders")
    .where("clientId", "==", clientId)
    .where("isPaidLater", "==", true)
    .where("isCancelled", "==", false);

  await adminDb.runTransaction(async (tx) => {
    // ALL READS FIRST
    const clientSnap = await tx.get(clientRef);
    if (!clientSnap.exists) {
      throw new Error("Client not found");
    }

    const clientData = clientSnap.data();
    const currentBalance = Number(clientData?.balance || 0);
    const newBalance = currentBalance + correctionAmount;

    // Don't allow correction that would leave negative balance (unless it's actually reducing debt)
    if (correctionAmount > 0 && newBalance < 0) {
      throw new Error("Correction would result in invalid negative balance");
    }

    let ordersToUpdate: Array<{
      ref: FirebaseFirestore.DocumentReference;
      currentRemaining: number;
      currentPaid: number;
      correctionToOrder: number;
      newRemaining: number;
      newPaid: number;
      isFullyPaid: boolean;
    }> = [];

    if (correctionAmount < 0) {
      const ordersSnap = await tx.get(ordersQuery);
      let remainingToCorrect = Math.abs(correctionAmount);

      const sortedDocs = ordersSnap.docs
        .map((doc) => ({ doc, data: convertTimestamp<Order>(doc.data()!) }))
        .sort((a, b) => {
          const dateA = a.data.createdAt ? new Date(a.data.createdAt).getTime() : 0;
          const dateB = b.data.createdAt ? new Date(b.data.createdAt).getTime() : 0;
          return dateA - dateB;
        });

      for (const { doc: orderDoc, data: order } of sortedDocs) {
        if (remainingToCorrect <= 0) break;

        const currentRemaining = typeof order.remainingAmount === "number" ? order.remainingAmount : order.totalAmount;

        if (currentRemaining <= 0) continue;

        const correctionToOrder = Math.min(remainingToCorrect, currentRemaining);
        const newRemaining = currentRemaining - correctionToOrder;
        const currentPaid = typeof order.amountPaid === "number" ? order.amountPaid : 0;
        const newPaid = currentPaid + correctionToOrder;
        const isFullyPaid = newRemaining <= 0;

        ordersToUpdate.push({
          ref: orderDoc.ref,
          currentRemaining,
          currentPaid,
          correctionToOrder,
          newRemaining,
          newPaid,
          isFullyPaid,
        });

        remainingToCorrect -= correctionToOrder;
      }
    }

    // ALL WRITES AFTER ALL READS
    tx.update(clientRef, {
      balance: FieldValue.increment(correctionAmount),
      updatedAt: nowTs,
    });

    const auditRef = adminDb.collection("debtCorrections").doc();
    tx.set(auditRef, {
      clientId,
      clientName: clientData?.name || "Cliente",
      correctionAmount,
      previousBalance: currentBalance,
      newBalance: currentBalance + correctionAmount,
      reason: reason.trim(),
      adminPassword: "***",
      createdAt: nowTs,
      competencyMonth: now.toISOString().slice(0, 7),
    });

    for (const order of ordersToUpdate) {
      const correctionRecord = {
        id: `correction_${Date.now()}_${order.ref.id}`,
        amount: order.correctionToOrder,
        method: "CORRECAO_ADMIN" as const,
        createdAt: nowTs,
      };

      tx.update(order.ref, {
        amountPaid: order.newPaid,
        remainingAmount: order.newRemaining,
        paymentHistory: FieldValue.arrayUnion(correctionRecord),
        ...(order.isFullyPaid ? { paidAt: nowTs } : {}),
      });
    }
  });
}

export async function applyFiadoPayment(
  clientId: string,
  orderId: string,
  amount: number,
  method: PaymentMethod["method"],
  receivedByUserId?: string
): Promise<void> {
  if (!amount || amount <= 0) {
    throw new Error("Payment amount must be greater than zero");
  }

  const orderRef = adminDb.collection("orders").doc(orderId);
  const clientRef = adminDb.collection("clients").doc(clientId);

  await adminDb.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw new Error("Order not found");
    }

    const order = convertTimestamp<Order>(orderSnap.data()!);
    if (!order.isPaidLater) {
      throw new Error("Order is not a FIADO order");
    }
    if (order.clientId !== clientId) {
      throw new Error("Order does not belong to this client");
    }

    const clientSnap = await tx.get(clientRef);
    if (!clientSnap.exists) {
      throw new Error("Client not found");
    }
    const clientName = String(clientSnap.data()?.name || order.clientName || "Cliente").trim();

    const currentPaid = typeof order.amountPaid === "number" ? order.amountPaid : order.paidAt ? order.totalAmount : 0;
    const currentRemaining =
      typeof order.remainingAmount === "number" ? order.remainingAmount : order.paidAt ? 0 : order.totalAmount;

    if (currentRemaining <= 0) {
      throw new Error("Order is already fully paid");
    }

    const appliedAmount = Math.min(amount, currentRemaining);
    const nextPaid = currentPaid + appliedAmount;
    const nextRemaining = Math.max(0, currentRemaining - appliedAmount);
    const now = new Date();
    await assertFinancialMonthOpen(now);
    const nowTs = Timestamp.fromDate(now);

    const payment: Omit<FiadoPayment, "createdAt"> & { createdAt: FirebaseFirestore.Timestamp } = {
      id: `pay_${Date.now()}`,
      amount: appliedAmount,
      method,
      createdAt: nowTs,
    };

    tx.update(orderRef, {
      amountPaid: nextPaid,
      remainingAmount: nextRemaining,
      paymentHistory: FieldValue.arrayUnion(payment),
      ...(nextRemaining === 0 ? { paidAt: nowTs } : {}),
    });

    tx.update(clientRef, {
      balance: FieldValue.increment(-appliedAmount),
      updatedAt: nowTs,
    });

    const safeReceivedByUserId = String(receivedByUserId || "").trim();
    let cashRegisterId: string | null = null;
    if (safeReceivedByUserId) {
      const openRegisterQuery = adminDb
        .collection("cashRegisters")
        .where("userId", "==", safeReceivedByUserId)
        .where("status", "==", "OPEN")
        .limit(1);
      const openRegisterSnapshot = await tx.get(openRegisterQuery);
      if (!openRegisterSnapshot.empty) {
        const registerDoc = openRegisterSnapshot.docs[0];
        const paymentField = mapOrderPaymentMethodToCashRegisterField(method);
        cashRegisterId = registerDoc.id;

        tx.update(registerDoc.ref, {
          totalSales: FieldValue.increment(appliedAmount),
          [paymentField]: FieldValue.increment(appliedAmount),
          salesCount: FieldValue.increment(1),
        });
      }
    }

    const movementRef = adminDb.collection("financialMovements").doc();
    const orderDate = order.createdAt instanceof Date ? order.createdAt : new Date();
    const orderDateStr = orderDate.toLocaleDateString("pt-BR");
    const description = `Pagamento compra ${orderDateStr} de ${clientName}`;
    tx.set(movementRef, {
      type: "FIADO_PAYMENT",
      direction: "IN",
      amount: appliedAmount,
      paymentMethod: mapOrderPaymentMethodToFinancial(method),
      relatedEntity: { kind: "order", id: orderId },
      occurredAt: nowTs,
      competencyMonth: toCompetencyMonth(now),
      createdBy: clientId,
      metadata: {
        clientId,
        clientName,
        description,
        orderDate: orderDateStr,
        receivedByUserId: safeReceivedByUserId || null,
        cashRegisterId,
      },
    });
  });
}

export async function removeFiadoOrderItem(
  clientId: string,
  orderId: string,
  orderItemId: string
): Promise<void> {
  const orderRef = adminDb.collection("orders").doc(orderId);
  const clientRef = adminDb.collection("clients").doc(clientId);
  const orderItemRef = adminDb.collection("orderItems").doc(orderItemId);

  await adminDb.runTransaction(async (tx) => {
    const [orderSnap, clientSnap, orderItemSnap] = await Promise.all([
      tx.get(orderRef),
      tx.get(clientRef),
      tx.get(orderItemRef),
    ]);

    if (!orderSnap.exists) {
      throw new Error("Order not found");
    }
    if (!clientSnap.exists) {
      throw new Error("Client not found");
    }
    if (!orderItemSnap.exists) {
      throw new Error("Order item not found");
    }

    const order = convertTimestamp<Order>(orderSnap.data()!);
    if (!order.isPaidLater) {
      throw new Error("Order is not a FIADO order");
    }
    if (order.clientId !== clientId) {
      throw new Error("Order does not belong to this client");
    }

    const orderItem = convertTimestamp<OrderItem>(orderItemSnap.data()!);
    if (orderItem.orderId !== orderId) {
      throw new Error("Order item does not belong to this order");
    }

    const productRef = adminDb.collection("products").doc(orderItem.productId);
    const productSnap = await tx.get(productRef);

    const removedRevenue = Number(orderItem.totalRevenue || orderItem.unitPrice * orderItem.quantity || 0);
    const removedCost = Number(orderItem.totalCost || orderItem.unitCost * orderItem.quantity || 0);

    const currentPaid = typeof order.amountPaid === "number" ? order.amountPaid : order.paidAt ? order.totalAmount : 0;
    const currentRemaining =
      typeof order.remainingAmount === "number" ? order.remainingAmount : order.paidAt ? 0 : order.totalAmount;
    const currentSubtotal =
      typeof order.subtotal === "number" ? order.subtotal : order.totalAmount + Number(order.discount || 0);
    const currentCogs = Number(order.cogsTotal || 0);

    const nextSubtotal = Math.max(0, currentSubtotal - removedRevenue);
    const nextTotal = Math.max(0, Number(order.totalAmount || 0) - removedRevenue);
    const nextCogs = Math.max(0, currentCogs - removedCost);
    const nextPaid = Math.min(currentPaid, nextTotal);
    const nextRemaining = Math.max(0, nextTotal - nextPaid);
    const clientBalanceDelta = nextRemaining - currentRemaining;
    const nowTs = Timestamp.fromDate(new Date());

    tx.update(orderRef, {
      subtotal: nextSubtotal,
      totalAmount: nextTotal,
      cogsTotal: nextCogs,
      amountPaid: nextPaid,
      remainingAmount: nextRemaining,
      paidAt: nextRemaining === 0 ? nowTs : null,
    });

    tx.update(clientRef, {
      balance: FieldValue.increment(clientBalanceDelta),
      updatedAt: nowTs,
    });

    if (productSnap.exists) {
      const productData = productSnap.data() as {
        stock?: number;
        sizes?: Array<{ size: string; stock: number }>;
      };

      const safeSize = String(orderItem.size || "").trim();
      const sizes = Array.isArray(productData.sizes) ? productData.sizes : [];
      const sizeIndex = safeSize ? sizes.findIndex((entry) => entry.size === safeSize) : -1;
      let nextSizes = sizes;

      if (safeSize) {
        if (sizeIndex >= 0) {
          nextSizes = sizes.map((entry, index) =>
            index === sizeIndex
              ? { ...entry, stock: Number(entry.stock || 0) + orderItem.quantity }
              : entry
          );
        } else {
          nextSizes = [...sizes, { size: safeSize, stock: orderItem.quantity }];
        }
      }

      tx.update(productRef, {
        stock: FieldValue.increment(orderItem.quantity),
        ...(safeSize ? { sizes: nextSizes } : {}),
        updatedAt: nowTs,
      });
    }

    tx.delete(orderItemRef);
  });
}
