import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { FinancialMovementPaymentMethod, Order, OrderItem, PaymentMethod, Product } from "@/lib/db-types";

interface CheckoutItem {
  productId: string;
  size: string;
  quantity: number;
}

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

export async function processCheckout(
  items: CheckoutItem[],
  payments: PaymentMethod[] = [],
  discount: number = 0,
  clientId?: string,
  clientName?: string,
  isPaidLater: boolean = false,
  createdById: string = "system",
  createdByRole: string = "ADMIN"
): Promise<Order> {
  if (createdByRole !== "ADMIN" && createdByRole !== "CASHIER") {
    throw new Error("Role not allowed to process checkout");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("No items in cart");
  }

  const now = new Date();
  const nowTs = Timestamp.fromDate(now);
  const competencyMonth = toCompetencyMonth(now);

  const orderRef = adminDb.collection("orders").doc();
  const saleMovementRef = adminDb.collection("financialMovements").doc();
  const cogsMovementRef = adminDb.collection("financialMovements").doc();

  // Stock is validated and decremented inside this transaction (read-then-write, atomically)
  // so concurrent checkouts for the same product/size can't both pass the stock check and
  // both decrement — Firestore retries the transaction on contention instead.
  const result = await adminDb.runTransaction(async (tx) => {
    const closureSnap = await tx.get(adminDb.collection("financialClosures").doc(competencyMonth));
    if (closureSnap.exists) {
      throw new Error(`Financial month ${competencyMonth} is closed`);
    }

    const productIds = Array.from(new Set(items.map((item) => item.productId)));
    const productRefs = productIds.map((id) => adminDb.collection("products").doc(id));
    const productSnaps = await Promise.all(productRefs.map((ref) => tx.get(ref)));

    const productsById = new Map<string, Product>();
    for (const snap of productSnaps) {
      if (!snap.exists) {
        throw new Error(`Product ${snap.id} not found`);
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
        throw new Error(`Product ${item.productId} not found`);
      }
      const quantity = Number(item.quantity);

      if (product.sizes.length > 0) {
        const sizeEntry = product.sizes.find((s) => s.size === item.size);
        if (!sizeEntry || sizeEntry.stock < quantity) {
          throw new Error(
            `Insufficient stock for ${product.name} size ${item.size}. Available: ${sizeEntry?.stock || 0}`
          );
        }
        sizeEntry.stock -= quantity;
      } else {
        if (product.stock < quantity) {
          throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stock}`);
        }
        product.stock -= quantity;
      }

      const unitCost = product.costPrice;
      const unitPrice = product.salePrice;
      const totalCost = unitCost * quantity;
      const totalRevenue = unitPrice * quantity;
      const profit = totalRevenue - totalCost;

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

    const totalAmount = Math.max(0, subtotal - discount);

    tx.set(orderRef, {
      subtotal,
      discount,
      totalAmount,
      cogsTotal,
      payments,
      createdById,
      ...(clientId && { clientId }),
      ...(clientName && { clientName }),
      ...(isPaidLater && {
        isPaidLater,
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
      createdBy: createdById,
      metadata: {
        subtotal,
        discount,
        isPaidLater,
        payments: (payments || []).map((payment) => ({
          method: mapOrderPaymentMethodToFinancial(payment.method),
          amount: Number(payment.amount || 0),
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
      createdBy: createdById,
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

    return { subtotal, cogsTotal, totalAmount, orderItems };
  });

  return {
    id: orderRef.id,
    subtotal: result.subtotal,
    discount,
    totalAmount: result.totalAmount,
    cogsTotal: result.cogsTotal,
    payments,
    createdAt: now,
    items: result.orderItems.map((item, index) => ({ ...item, id: `item-${index}`, orderId: orderRef.id })),
  };
}
