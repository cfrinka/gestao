import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { getProduct } from "@/domains/products/products-db";
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

async function assertFinancialMonthOpen(date: Date): Promise<void> {
  const month = toCompetencyMonth(date);
  const closure = await adminDb.collection("financialClosures").doc(month).get();
  if (closure.exists) {
    throw new Error(`Financial month ${month} is closed`);
  }
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

  const batch = adminDb.batch();

  const products: (Product & { requestedQty: number; requestedSize: string })[] = [];
  for (const item of items) {
    const product = await getProduct(item.productId);
    if (!product) {
      throw new Error(`Product ${item.productId} not found`);
    }
    if (product.sizes && product.sizes.length > 0) {
      const sizeStock = product.sizes.find((s) => s.size === item.size);
      if (!sizeStock || sizeStock.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name} size ${item.size}. Available: ${sizeStock?.stock || 0}`);
      }
    } else if (product.stock < item.quantity) {
      throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stock}`);
    }
    products.push({ ...product, requestedQty: item.quantity, requestedSize: item.size });
  }

  let subtotal = 0;
  let cogsTotal = 0;
  const orderItems: Omit<OrderItem, "id">[] = [];

  for (const product of products) {
    const quantity = product.requestedQty;
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
      ...(product.ownerId ? { ownerId: product.ownerId } : {}),
      size: product.requestedSize,
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
  const now = new Date();
  await assertFinancialMonthOpen(now);
  const nowTs = Timestamp.fromDate(now);
  const competencyMonth = toCompetencyMonth(now);

  const orderRef = adminDb.collection("orders").doc();
  batch.set(orderRef, {
    subtotal,
    discount,
    totalAmount,
    cogsTotal,
    payments,
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

  const saleMovementRef = adminDb.collection("financialMovements").doc();
  batch.set(saleMovementRef, {
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

  const cogsMovementRef = adminDb.collection("financialMovements").doc();
  batch.set(cogsMovementRef, {
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
    batch.set(itemRef, { ...itemData, orderId: orderRef.id, createdAt: nowTs });
  }

  for (const product of products) {
    const productRef = adminDb.collection("products").doc(product.id);

    if (product.sizes && product.sizes.length > 0) {
      const updatedSizes = product.sizes.map((s) =>
        s.size === product.requestedSize ? { ...s, stock: s.stock - product.requestedQty } : s
      );
      // Recalculate total stock from sizes to ensure consistency
      const newStock = updatedSizes.reduce((sum, s) => sum + Number(s.stock || 0), 0);
      batch.update(productRef, {
        stock: newStock,
        sizes: updatedSizes,
        updatedAt: nowTs,
      });
    } else {
      batch.update(productRef, {
        stock: FieldValue.increment(-product.requestedQty),
        updatedAt: nowTs,
      });
    }
  }

  await batch.commit();

  return {
    id: orderRef.id,
    subtotal,
    discount,
    totalAmount,
    cogsTotal,
    payments,
    createdAt: now,
    items: orderItems.map((item, index) => ({ ...item, id: `item-${index}`, orderId: orderRef.id })),
  };
}
