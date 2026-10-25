import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { FinancialMovementPaymentMethod, Order, OrderItem, PaymentMethod, Product } from "@/lib/db-types";
import { HttpError, closedMonthError } from "@/lib/api/http-errors";
import { roundMoney } from "@/lib/money";
import type { ProcessCheckoutInput } from "@/domains/checkout/repository";

function toCompetencyMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
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

export async function processCheckout(input: ProcessCheckoutInput): Promise<Order> {
  const { items, payments, change, discount, expectedTotal, clientId, clientName, payLater, cashRegisterId } = input;

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
  const registerRef = adminDb.collection("cashRegisters").doc(cashRegisterId);
  const clientRef = payLater && clientId ? adminDb.collection("clients").doc(clientId) : null;

  // Stock is validated and decremented inside this transaction (read-then-write, atomically)
  // so concurrent checkouts for the same product/size can't both pass the stock check and
  // both decrement — Firestore retries the transaction on contention instead. The register
  // totals and the fiado balance are written here too, so a sale can never exist without them.
  const result = await adminDb.runTransaction(async (tx) => {
    const closureSnap = await tx.get(adminDb.collection("financialClosures").doc(competencyMonth));
    if (closureSnap.exists) {
      throw closedMonthError(competencyMonth);
    }

    const productIds = Array.from(new Set(items.map((item) => item.productId)));
    const productRefs = productIds.map((id) => adminDb.collection("products").doc(id));
    const productSnaps = await Promise.all(productRefs.map((ref) => tx.get(ref)));
    const registerSnap = await tx.get(registerRef);
    const clientSnap = clientRef ? await tx.get(clientRef) : null;

    const register = registerSnap.data() as { status?: string; userId?: string } | undefined;
    if (!registerSnap.exists || register?.status !== "OPEN" || register?.userId !== input.createdById) {
      throw new HttpError(409, "O caixa não está mais aberto. Abra o caixa e refaça a venda.");
    }

    if (clientRef && !clientSnap?.exists) {
      throw new HttpError(404, "Cliente não encontrado");
    }

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
      cashRegisterId,
      isCancelled: false,
      createdById: input.createdById,
      createdByName: input.createdByName,
      ...(clientId && { clientId }),
      ...(clientName && { clientName }),
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

    if (payLater) {
      if (clientRef) {
        tx.update(clientRef, {
          balance: FieldValue.increment(totalAmount),
          updatedAt: nowTs,
        });
      }
    } else {
      tx.update(registerRef, {
        totalSales: FieldValue.increment(totalAmount),
        totalCash: FieldValue.increment(paymentAmount(payments, "DINHEIRO")),
        totalDebit: FieldValue.increment(paymentAmount(payments, "DEBITO")),
        totalCredit: FieldValue.increment(paymentAmount(payments, "CREDITO")),
        totalPix: FieldValue.increment(paymentAmount(payments, "PIX")),
        salesCount: FieldValue.increment(1),
      });
    }

    return { subtotal, cogsTotal, totalAmount, orderItems };
  });

  return {
    id: orderRef.id,
    subtotal: result.subtotal,
    discount,
    totalAmount: result.totalAmount,
    cogsTotal: result.cogsTotal,
    payments,
    ...(change > 0 ? { change } : {}),
    cashRegisterId,
    isCancelled: false,
    ...(clientId ? { clientId } : {}),
    ...(clientName ? { clientName } : {}),
    ...(payLater ? { isPaidLater: true, amountPaid: 0, remainingAmount: result.totalAmount } : {}),
    createdById: input.createdById,
    createdByName: input.createdByName,
    createdAt: now,
    items: result.orderItems.map((item, index) => ({ ...item, id: `item-${index}`, orderId: orderRef.id })),
  };
}
