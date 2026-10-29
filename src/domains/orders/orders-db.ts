import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { FinancialMovementPaymentMethod, Order, OrderItem, PaymentMethod } from "@/lib/db-types";
import { convertTimestamp } from "@/domains/shared/firestore-serializers";
import { getProductsCached } from "@/domains/products/products-db";
import { roundMoney } from "@/lib/money";
import { normalizePayments } from "@/domains/checkout/cart-validation";
import { HttpError, closedMonthError } from "@/lib/api/http-errors";
import { addDaysISO, endOfStoreDay, startOfStoreDay, toCompetencyMonth, todayISO } from "@/lib/dates";

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

/**
 * The register that took this sale. Sales now carry their register id; older sales are matched
 * by time window, but only among registers of the operator who made the sale — the most recent
 * register of any operator would put a cancellation on someone else's drawer.
 */
async function findMatchingCashRegister(
  tx: FirebaseFirestore.Transaction,
  order: Pick<Order, "cashRegisterId" | "createdById">,
  orderCreatedAt: Date
): Promise<FirebaseFirestore.DocumentSnapshot | undefined> {
  if (order.cashRegisterId) {
    const snap = await tx.get(adminDb.collection("cashRegisters").doc(order.cashRegisterId));
    return snap.exists ? snap : undefined;
  }

  const registerQuery = adminDb
    .collection("cashRegisters")
    .where("openedAt", "<=", Timestamp.fromDate(orderCreatedAt))
    .orderBy("openedAt", "desc")
    .limit(30);
  const registerSnapshot = await tx.get(registerQuery);
  return registerSnapshot.docs.find((doc) => {
    const data = doc.data();
    if (order.createdById && data.userId && data.userId !== order.createdById) return false;
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

export async function cancelOrder(input: {
  orderId: string;
  actorId: string;
  actorRole: string;
  reason?: string;
}): Promise<Order> {
  if (input.actorRole !== "ADMIN") {
    throw new HttpError(403, "Só administradores podem cancelar vendas");
  }

  const safeReason = String(input.reason || "").trim();
  const orderRef = adminDb.collection("orders").doc(input.orderId);

  return adminDb.runTransaction(async (tx) => {
    // ── ALL READS FIRST ──
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw new HttpError(404, "Venda não encontrada");
    }

    const order = convertTimestamp<Order>(orderSnap.data()!);
    if (order.isCancelled) {
      throw new HttpError(409, "Esta venda já foi cancelada");
    }
    // A fiado sale can be cancelled as a whole only while nothing has been received for it;
    // once the client has paid part of it, items are removed from the client's screen instead,
    // where the payment already made is kept and credited.
    const fiadoPaid = roundMoney(Number(order.amountPaid || 0));
    if (order.isPaidLater && (fiadoPaid > 0 || (order.paymentHistory?.length ?? 0) > 0)) {
      throw new HttpError(
        409,
        "Esta venda fiado já recebeu pagamento. Remova os itens pelo cadastro do cliente em Clientes e fiado."
      );
    }
    const clientRef = order.isPaidLater && order.clientId ? adminDb.collection("clients").doc(order.clientId) : null;
    const clientSnap = clientRef ? await tx.get(clientRef) : null;

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
    const matchingRegister = await findMatchingCashRegister(tx, order, orderCreatedAt);

    // Cancelling would zero out this order's SALE_REVENUE/COGS movements — if its
    // competency month is already closed, that would silently diverge the frozen
    // financialClosures snapshot from the live movements. Block it instead, matching
    // how every other financial write in the app treats a closed month.
    const orderMonth = toCompetencyMonth(orderCreatedAt);
    const closureSnap = await tx.get(adminDb.collection("financialClosures").doc(orderMonth));
    if (closureSnap.exists) {
      throw closedMonthError(orderMonth);
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
      ...(order.isPaidLater ? { remainingAmount: 0 } : {}),
      updatedAt: nowTs,
    });

    if (clientRef && clientSnap?.exists) {
      const stillOwed = roundMoney(
        typeof order.remainingAmount === "number" ? order.remainingAmount : Number(order.totalAmount || 0)
      );
      if (stillOwed > 0) {
        tx.update(clientRef, { balance: FieldValue.increment(-stillOwed), updatedAt: nowTs });
      }
    }

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
    // A fiado sale never added anything to the register, so cancelling it takes nothing out.
    const canAdjustRegister = !order.isPaidLater && Boolean(matchingRegister) && registerStatus === "OPEN";

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
    throw new HttpError(403, "Só administradores podem editar vendas");
  }

  const safeDiscount = roundMoney(Number(input.discount || 0));
  if (!Number.isFinite(safeDiscount) || safeDiscount < 0) {
    throw new HttpError(400, "Desconto inválido");
  }

  const normalizedPayments = normalizePayments(input.payments);

  const orderRef = adminDb.collection("orders").doc(input.orderId);

  return adminDb.runTransaction(async (tx) => {
    // ── ALL READS FIRST ──
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw new HttpError(404, "Venda não encontrada");
    }

    const order = convertTimestamp<Order>(orderSnap.data()!);
    if (order.isCancelled) {
      throw new HttpError(409, "Vendas canceladas não podem ser editadas");
    }
    if (order.isPaidLater) {
      throw new HttpError(400, "Vendas fiado não podem ser editadas por aqui");
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
    const matchingRegister = await findMatchingCashRegister(tx, order, orderCreatedAt);

    // Editing would change this order's SALE_REVENUE movement — block it for a
    // closed competency month so the frozen financialClosures snapshot can't diverge.
    const orderMonth = toCompetencyMonth(orderCreatedAt);
    const closureSnap = await tx.get(adminDb.collection("financialClosures").doc(orderMonth));
    if (closureSnap.exists) {
      throw closedMonthError(orderMonth);
    }

    // ── VALIDATION ──
    const subtotal = roundMoney(items.reduce((sum, item) => sum + Number(item.totalRevenue || 0), 0));
    if (safeDiscount > subtotal) {
      throw new HttpError(400, "O desconto não pode ser maior que o subtotal");
    }

    const nextTotalAmount = roundMoney(Math.max(0, subtotal - safeDiscount));
    const totalPaid = roundMoney(normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0));
    if (Math.abs(totalPaid - nextTotalAmount) > 0.01) {
      throw new HttpError(400, "A soma dos pagamentos precisa ser igual ao total da venda");
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

    // A CLOSED register is a frozen record of what was counted that day (see cancelOrder) —
    // editing an old sale must not rewrite it.
    if (matchingRegister && matchingRegister.data()?.status === "OPEN") {
      const previousByMethod = paymentAmountByMethod((order.payments || []) as Array<{
        method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX";
        amount: number;
      }>);
      const nextByMethod = paymentAmountByMethod(normalizedPayments);
      const previousTotal = Number(order.totalAmount || 0);
      const totalDelta = roundMoney(nextTotalAmount - previousTotal);

      tx.update(matchingRegister.ref, {
        totalSales: FieldValue.increment(totalDelta),
        totalCash: FieldValue.increment(roundMoney(nextByMethod.DINHEIRO - previousByMethod.DINHEIRO)),
        totalDebit: FieldValue.increment(roundMoney(nextByMethod.DEBITO - previousByMethod.DEBITO)),
        totalCredit: FieldValue.increment(roundMoney(nextByMethod.CREDITO - previousByMethod.CREDITO)),
        totalPix: FieldValue.increment(roundMoney(nextByMethod.PIX - previousByMethod.PIX)),
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

const byNewestFirst = (a: { createdAt: Date }, b: { createdAt: Date }) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

/**
 * Orders in a period with their items. Both are read by date range, in parallel: asking Firestore
 * to sort a date range ("orderBy desc") made the same query three times slower, and fetching items
 * by order id ("in" queries) is slower still — so sorting happens here, and only orders whose
 * items carry no date (very old sales) fall back to the id lookup.
 */
export async function getOrders(startDate?: Date, endDate?: Date): Promise<Order[]> {
  if (!startDate || !endDate) {
    const snapshot = await adminDb.collection("orders").orderBy("createdAt", "desc").get();
    const itemsByOrderId = await getItemsForOrders(snapshot.docs.map((doc) => doc.id));
    return snapshot.docs.map((orderDoc) => ({
      id: orderDoc.id,
      ...convertTimestamp<Omit<Order, "id">>(orderDoc.data()),
      items: itemsByOrderId.get(orderDoc.id) ?? [],
    }));
  }

  const [ordersSnapshot, itemsByOrderId] = await Promise.all([
    adminDb
      .collection("orders")
      .where("createdAt", ">=", Timestamp.fromDate(startDate))
      .where("createdAt", "<=", Timestamp.fromDate(endDate))
      .get(),
    getItemsInRange(startDate, endDate),
  ]);

  const orders: Order[] = ordersSnapshot.docs.map((orderDoc) => ({
    id: orderDoc.id,
    ...convertTimestamp<Omit<Order, "id">>(orderDoc.data()),
  }));
  await fillMissingItems(orders, itemsByOrderId);

  return orders
    .map((order) => ({ ...order, items: itemsByOrderId.get(order.id) ?? [] }))
    .sort(byNewestFirst);
}

export interface FiadoPaymentListEntry {
  id: string;
  entryType: "fiado_payment";
  createdAt: Date;
  totalAmount: number;
  clientName: string;
  payments: PaymentMethod[];
  items: OrderItem[];
  relatedOrderId: string;
}

function mapFinancialToOrderPaymentMethod(method?: FinancialMovementPaymentMethod): PaymentMethod["method"] {
  if (method === "cash") return "DINHEIRO";
  if (method === "pix") return "PIX";
  if (method === "credit") return "CREDITO";
  return "DEBITO";
}

/**
 * Fiado payments received in a period, as pseudo-sale entries for the Vendas screen. A payment
 * only updates the original order (see fiado-payment.ts) — it never creates a new order — so
 * without this, money that comes in today against an old fiado sale is invisible when the
 * screen is filtered to "hoje". Filters by type in JS rather than in the query, matching the
 * cash register's reading of the same collection, to avoid a composite index on type+occurredAt.
 */
export async function getFiadoPaymentEntries(startDate?: Date, endDate?: Date): Promise<FiadoPaymentListEntry[]> {
  let query: FirebaseFirestore.Query = adminDb.collection("financialMovements");
  if (startDate && endDate) {
    query = query
      .where("occurredAt", ">=", Timestamp.fromDate(startDate))
      .where("occurredAt", "<=", Timestamp.fromDate(endDate));
  }
  const snapshot = await query.get();

  type FiadoPaymentMovement = {
    id: string;
    type?: string;
    amount?: number;
    paymentMethod?: FinancialMovementPaymentMethod;
    occurredAt?: Date;
    metadata?: Record<string, unknown>;
  };

  return snapshot.docs
    .map(
      (doc) =>
        ({ id: doc.id, ...convertTimestamp<Record<string, unknown>>(doc.data()) }) as FiadoPaymentMovement
    )
    .filter((movement) => movement.type === "FIADO_PAYMENT")
    .map((movement) => {
      const metadata = (movement.metadata as Record<string, unknown>) || {};
      const amount = roundMoney(Number(movement.amount || 0));
      const occurredAt = movement.occurredAt instanceof Date ? movement.occurredAt : new Date();
      const method = mapFinancialToOrderPaymentMethod(movement.paymentMethod as FinancialMovementPaymentMethod | undefined);

      return {
        id: `fiado-payment-${movement.id}`,
        entryType: "fiado_payment" as const,
        createdAt: occurredAt,
        totalAmount: amount,
        clientName: String(metadata.clientName || "Cliente"),
        payments: [{ method, amount }],
        items: [] as OrderItem[],
        relatedOrderId: String(metadata.orderId || ""),
      };
    });
}

/** Items written in a period (checkout stamps each item with its sale's time). */
async function getItemsInRange(startDate: Date, endDate: Date): Promise<Map<string, OrderItem[]>> {
  const snapshot = await adminDb
    .collection("orderItems")
    .where("createdAt", ">=", Timestamp.fromDate(startDate))
    .where("createdAt", "<=", Timestamp.fromDate(endDate))
    .get();
  const itemsByOrderId = new Map<string, OrderItem[]>();
  for (const itemDoc of snapshot.docs) {
    const item = { id: itemDoc.id, ...itemDoc.data() } as OrderItem;
    const list = itemsByOrderId.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrderId.set(item.orderId, list);
  }
  return itemsByOrderId;
}

/** Looks up by id the items of orders the date-range read did not cover (old undated items). */
async function fillMissingItems(orders: Order[], itemsByOrderId: Map<string, OrderItem[]>): Promise<void> {
  const missing = orders.filter((order) => !itemsByOrderId.has(order.id)).map((order) => order.id);
  if (missing.length === 0) return;
  const found = await getItemsForOrders(missing);
  found.forEach((items, orderId) => itemsByOrderId.set(orderId, items));
}

/**
 * Line items for many orders at once: "in" queries of 30 ids, a few at a time. This replaces one
 * sequential query per order, which made the Vendas screen slower with every sale ever made.
 */
export async function getItemsForOrders(orderIds: string[]): Promise<Map<string, OrderItem[]>> {
  const itemsByOrderId = new Map<string, OrderItem[]>();
  const chunks: string[][] = [];
  for (let i = 0; i < orderIds.length; i += 30) chunks.push(orderIds.slice(i, i + 30));

  for (let i = 0; i < chunks.length; i += 8) {
    const snapshots = await Promise.all(
      chunks.slice(i, i + 8).map((chunk) => adminDb.collection("orderItems").where("orderId", "in", chunk).get())
    );
    for (const snapshot of snapshots) {
      for (const itemDoc of snapshot.docs) {
        const item = { id: itemDoc.id, ...itemDoc.data() } as OrderItem;
        const list = itemsByOrderId.get(item.orderId) ?? [];
        list.push(item);
        itemsByOrderId.set(item.orderId, list);
      }
    }
  }

  return itemsByOrderId;
}

/**
 * What Início needs: sales in the last 30 days, how many products exist, and the latest sales.
 * One date-range read gives both the count and the latest sales (the all-time count() aggregation
 * took almost a second on its own); products come from the cached catalogue.
 */
export async function getOrdersSummary(recentLimit: number): Promise<{
  ordersCount: number;
  productsCount: number;
  recent: Array<{ id: string; createdAt: Date; totalAmount: number; itemCount: number }>;
}> {
  const today = todayISO();
  const startDate = startOfStoreDay(addDaysISO(today, -29))!;
  const endDate = endOfStoreDay(today)!;

  const [ordersSnapshot, itemsByOrderId, products] = await Promise.all([
    adminDb
      .collection("orders")
      .where("createdAt", ">=", Timestamp.fromDate(startDate))
      .where("createdAt", "<=", Timestamp.fromDate(endDate))
      .get(),
    getItemsInRange(startDate, endDate),
    getProductsCached(),
  ]);

  const sales = ordersSnapshot.docs
    .map((doc) => ({ id: doc.id, ...convertTimestamp<Omit<Order, "id">>(doc.data()) }))
    .filter((order) => order.isCancelled !== true)
    .sort(byNewestFirst);
  const recent = sales.slice(0, recentLimit);
  await fillMissingItems(recent, itemsByOrderId);

  return {
    ordersCount: sales.length,
    productsCount: products.length,
    recent: recent.map((order) => ({
      id: order.id,
      createdAt: order.createdAt,
      totalAmount: Number(order.totalAmount || 0),
      itemCount: (itemsByOrderId.get(order.id) ?? []).length,
    })),
  };
}
