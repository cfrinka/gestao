import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { FinancialMovementPaymentMethod, OrderItem, PaymentMethod, Product } from "@/lib/db-types";
import { HttpError, IDEMPOTENCY_CONFLICT_MESSAGE, closedMonthError } from "@/lib/api/http-errors";
import { roundMoney } from "@/lib/money";
import type {
  CheckoutIdempotency,
  CheckoutOrder,
  CheckoutResult,
  FiadoStanding,
  ProcessCheckoutInput,
} from "@/domains/checkout/repository";
import { toCompetencyMonth } from "@/lib/dates";
import { convertTimestamp } from "@/domains/shared/firestore-serializers";
import { oldestOpenFiadoAt, type FiadoOrderLike } from "@/domains/clients/fiado-credit";
import { isValidPhone } from "@/lib/phone";

function idempotencyRef(idempotency: CheckoutIdempotency) {
  // Same document layout as domains/shared/idempotency.ts uses for the other flows.
  return adminDb.collection("idempotencyKeys").doc(`checkout:${idempotency.ownerId}:${idempotency.key}`);
}

export async function findCompletedCheckout(idempotency: CheckoutIdempotency): Promise<CheckoutOrder | null> {
  const snap = await idempotencyRef(idempotency).get();
  const data = snap.data() as { requestHash?: string; status?: string; response?: CheckoutOrder } | undefined;
  if (!data || data.status !== "COMPLETED" || data.requestHash !== idempotency.requestHash) return null;
  return data.response ?? null;
}

export async function getFiadoStanding(clientId: string): Promise<FiadoStanding | null> {
  const [clientSnap, ordersSnap] = await Promise.all([
    adminDb.collection("clients").doc(clientId).get(),
    adminDb.collection("orders").where("clientId", "==", clientId).where("isPaidLater", "==", true).get(),
  ]);
  if (!clientSnap.exists) return null;
  const data = clientSnap.data() as { name?: string; balance?: number; phone?: string };
  return {
    name: String(data.name || "").trim() || "Cliente",
    balance: roundMoney(Number(data.balance || 0)),
    phone: String(data.phone || ""),
    oldestOpenAt: oldestOpenFiadoAt(ordersSnap.docs.map((doc) => doc.data() as FiadoOrderLike)),
  };
}

function mapOrderPaymentMethodToFinancial(method: PaymentMethod["method"]): FinancialMovementPaymentMethod {
  if (method === "DINHEIRO") return "cash";
  if (method === "PIX") return "pix";
  if (method === "CREDITO") return "credit";
  return "debit";
}

function paymentAmount(payments: PaymentMethod[], method: PaymentMethod["method"]): number {
  return payments.find((p) => p.method === method)?.amount || 0;
}

export async function processCheckout(input: ProcessCheckoutInput): Promise<CheckoutResult> {
  const { items, payments, change, discount, expectedTotal, clientId, payLater, idempotency } = input;

  if (input.createdByRole !== "ADMIN" && input.createdByRole !== "CASHIER") {
    throw new HttpError(403, "Seu perfil não pode registrar vendas");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, "Adicione ao menos um produto à venda");
  }

  const now = new Date();
  const nowTs = Timestamp.fromDate(now);
  const competencyMonth = toCompetencyMonth(now);

  const orderRef = adminDb.collection("orders").doc();
  const saleMovementRef = adminDb.collection("financialMovements").doc();
  const cogsMovementRef = adminDb.collection("financialMovements").doc();
  const idemRef = idempotencyRef(idempotency);
  const openRegisterQuery = adminDb
    .collection("cashRegisters")
    .where("userId", "==", input.createdById)
    .where("status", "==", "OPEN")
    .limit(1);
  const clientRef = payLater && clientId ? adminDb.collection("clients").doc(clientId) : null;

  // Stock is validated and decremented inside this transaction (read-then-write, atomically)
  // so concurrent checkouts for the same product/size can't both pass the stock check and
  // both decrement — Firestore retries the transaction on contention instead. The register
  // totals and the fiado balance are written here too, so a sale can never exist without them.
  const productIds = Array.from(new Set(items.map((item) => item.productId)));
  const productRefs = productIds.map((id) => adminDb.collection("products").doc(id));

  const result = await adminDb.runTransaction(async (tx) => {
    // Every read is issued at once: the sale costs one round of reads plus the commit.
    const [idemSnap, closureSnap, registerQuerySnap, clientSnap, productSnaps] = await Promise.all([
      tx.get(idemRef),
      tx.get(adminDb.collection("financialClosures").doc(competencyMonth)),
      tx.get(openRegisterQuery),
      clientRef ? tx.get(clientRef) : Promise.resolve(null),
      Promise.all(productRefs.map((ref) => tx.get(ref))),
    ]);

    const previous = idemSnap.data() as { requestHash?: string; status?: string; response?: CheckoutOrder } | undefined;
    if (previous) {
      if (previous.requestHash !== idempotency.requestHash) {
        throw new HttpError(409, IDEMPOTENCY_CONFLICT_MESSAGE);
      }
      if (previous.status === "COMPLETED" && previous.response) {
        return { replayed: true as const, order: previous.response };
      }
    }

    if (closureSnap.exists) {
      throw closedMonthError(competencyMonth);
    }

    const registerDoc = registerQuerySnap.docs[0];
    if (!registerDoc) {
      throw new HttpError(409, "Abra o caixa para finalizar a venda.");
    }
    const registerRef = registerDoc.ref;
    const cashRegisterId = registerDoc.id;

    if (clientRef && !clientSnap?.exists) {
      throw new HttpError(404, "Cliente não encontrado");
    }
    const clientName = clientSnap?.exists ? String(clientSnap.data()?.name || "").trim() || undefined : undefined;

    const productsById = new Map<string, Product>();
    for (const snap of productSnaps) {
      if (!snap.exists) {
        throw new HttpError(404, "Um dos produtos da venda não existe mais. Atualize a tela.");
      }
      const data = snap.data() as Product;
      productsById.set(snap.id, {
        ...data,
        id: snap.id,
        sizes: Array.isArray(data.sizes) ? data.sizes.map((s) => ({ ...s })) : [],
      });
    }

    let subtotal = 0;
    let cogsTotal = 0;
    const orderItems: Omit<OrderItem, "id">[] = [];

    for (const item of items) {
      const product = productsById.get(item.productId);
      if (!product) {
        throw new HttpError(404, "Um dos produtos da venda não existe mais. Atualize a tela.");
      }
      const quantity = Number(item.quantity);

      if (product.sizes.length > 0) {
        const sizeEntry = product.sizes.find((s) => s.size === item.size);
        if (!sizeEntry || sizeEntry.stock < quantity) {
          throw new HttpError(
            409,
            `Estoque insuficiente de ${product.name} no tamanho ${item.size}. Disponível: ${sizeEntry?.stock || 0}`
          );
        }
        sizeEntry.stock -= quantity;
      } else {
        if (product.stock < quantity) {
          throw new HttpError(409, `Estoque insuficiente de ${product.name}. Disponível: ${product.stock}`);
        }
        product.stock -= quantity;
      }

      const unitCost = Number(product.costPrice || 0);
      const unitPrice = Number(product.salePrice || 0);
      const totalCost = roundMoney(unitCost * quantity);
      const totalRevenue = roundMoney(unitPrice * quantity);
      const profit = roundMoney(totalRevenue - totalCost);

      subtotal += totalRevenue;
      cogsTotal += totalCost;

      orderItems.push({
        orderId: "",
        productId: product.id,
        productName: product.name,
        ...(product.ownerId ? { ownerId: product.ownerId } : {}),
        size: item.size,
        quantity,
        unitCostAtSale: unitCost,
        unitCost,
        unitPrice,
        totalCost,
        totalRevenue,
        profit,
      });
    }

    subtotal = roundMoney(subtotal);
    cogsTotal = roundMoney(cogsTotal);
    const totalAmount = roundMoney(Math.max(0, subtotal - discount));

    // Payments were settled against the total the POS showed. If a price changed in between,
    // the cashier must see the new total before charging it.
    if (Math.abs(totalAmount - expectedTotal) > 0.01) {
      throw new HttpError(409, "O preço de algum produto mudou. Atualize a tela e refaça a venda.");
    }

    tx.set(orderRef, {
      subtotal,
      discount,
      totalAmount,
      cogsTotal,
      payments,
      ...(change > 0 ? { change } : {}),
      ...(input.customerPhone ? { customerPhone: input.customerPhone } : {}),
      ...(input.promoDiscount > 0 ? { promoDiscount: input.promoDiscount } : {}),
      ...(input.manualDiscount > 0 ? { manualDiscount: input.manualDiscount } : {}),
      cashRegisterId,
      isCancelled: false,
      createdById: input.createdById,
      createdByName: input.createdByName,
      ...(clientId ? { clientId } : {}),
      ...(clientName ? { clientName } : {}),
      ...(payLater && {
        isPaidLater: true,
        amountPaid: 0,
        remainingAmount: totalAmount,
        paymentHistory: [],
      }),
      createdAt: nowTs,
    });

    tx.set(saleMovementRef, {
      type: "SALE_REVENUE",
      direction: "IN",
      amount: totalAmount,
      relatedEntity: { kind: "order", id: orderRef.id },
      occurredAt: nowTs,
      competencyMonth,
      createdBy: input.createdById,
      metadata: {
        subtotal,
        discount,
        isPaidLater: payLater,
        payments: payments.map((payment) => ({
          method: mapOrderPaymentMethodToFinancial(payment.method),
          amount: payment.amount,
        })),
      },
    });

    tx.set(cogsMovementRef, {
      type: "COGS",
      direction: "OUT",
      amount: cogsTotal,
      relatedEntity: { kind: "order", id: orderRef.id },
      occurredAt: nowTs,
      competencyMonth,
      createdBy: input.createdById,
    });

    for (const itemData of orderItems) {
      const itemRef = adminDb.collection("orderItems").doc();
      tx.set(itemRef, { ...itemData, orderId: orderRef.id, createdAt: nowTs });
    }

    for (const [productId, product] of Array.from(productsById.entries())) {
      const productRef = adminDb.collection("products").doc(productId);
      if (product.sizes.length > 0) {
        const newStock = product.sizes.reduce((sum, s) => sum + Number(s.stock || 0), 0);
        tx.update(productRef, {
          stock: newStock,
          sizes: product.sizes,
          updatedAt: nowTs,
        });
      } else {
        tx.update(productRef, {
          stock: product.stock,
          updatedAt: nowTs,
        });
      }
    }

    const registerData = registerDoc.data() as Record<string, unknown>;
    const registerAfter: Record<string, unknown> = { id: cashRegisterId, ...convertTimestamp<Record<string, unknown>>(registerData) };

    if (payLater) {
      if (clientRef) {
        // A phone typed at the counter fills a missing one; it never replaces a valid number.
        const savePhone = input.clientPhone && !isValidPhone(clientSnap?.data()?.phone);
        tx.update(clientRef, {
          balance: FieldValue.increment(totalAmount),
          ...(savePhone ? { phone: input.clientPhone } : {}),
          updatedAt: nowTs,
        });
      }
    } else {
      const increments = {
        totalSales: totalAmount,
        totalCash: paymentAmount(payments, "DINHEIRO"),
        totalDebit: paymentAmount(payments, "DEBITO"),
        totalCredit: paymentAmount(payments, "CREDITO"),
        totalPix: paymentAmount(payments, "PIX"),
        salesCount: 1,
      };
      tx.update(
        registerRef,
        Object.fromEntries(Object.entries(increments).map(([field, value]) => [field, FieldValue.increment(value)]))
      );
      for (const [field, value] of Object.entries(increments)) {
        registerAfter[field] = roundMoney(Number(registerAfter[field] || 0) + value);
      }
    }

    const order: CheckoutOrder = {
      id: orderRef.id,
      subtotal,
      discount,
      totalAmount,
      cogsTotal,
      payments,
      ...(change > 0 ? { change } : {}),
      ...(input.customerPhone ? { customerPhone: input.customerPhone } : {}),
      cashRegisterId,
      isCancelled: false,
      ...(clientId ? { clientId } : {}),
      ...(clientName ? { clientName } : {}),
      ...(payLater ? { isPaidLater: true, amountPaid: 0, remainingAmount: totalAmount } : {}),
      createdById: input.createdById,
      createdByName: input.createdByName,
      createdAt: now,
      items: orderItems.map((item, index) => ({ ...item, id: `item-${index}`, orderId: orderRef.id })),
      updatedStock: Array.from(productsById.values()).map((product) => ({
        productId: product.id,
        stock: product.sizes.length > 0 ? product.sizes.reduce((sum, s) => sum + Number(s.stock || 0), 0) : product.stock,
        sizes: product.sizes,
      })),
      register: registerAfter,
    };

    // The key is completed in the same commit as the sale: a retry finds the order, never a
    // half-finished attempt.
    tx.set(idemRef, {
      scope: "checkout",
      ownerId: idempotency.ownerId,
      key: idempotency.key,
      requestHash: idempotency.requestHash,
      status: "COMPLETED",
      response: JSON.parse(JSON.stringify(order)),
      createdAt: now,
      completedAt: now,
      updatedAt: now,
    });

    return { replayed: false as const, order };
  });

  return result;
}
