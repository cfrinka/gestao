import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { Product, StockPurchaseEntry } from "@/lib/db-types";
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

export async function getProducts(): Promise<Product[]> {
  const snapshot = await adminDb.collection("products").orderBy("name").get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    plusSized: doc.data()?.plusSized === true,
    ...convertTimestamp<Omit<Product, "id">>(doc.data()),
  }));
}

export async function getProduct(id: string): Promise<Product | null> {
  const doc = await adminDb.collection("products").doc(id).get();
  if (!doc.exists) return null;
  return {
    id: doc.id,
    plusSized: doc.data()?.plusSized === true,
    ...convertTimestamp<Omit<Product, "id">>(doc.data()!),
  };
}

export async function getProductBySku(sku: string): Promise<Product | null> {
  const snapshot = await adminDb.collection("products").where("sku", "==", sku).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return {
    id: doc.id,
    plusSized: doc.data()?.plusSized === true,
    ...convertTimestamp<Omit<Product, "id">>(doc.data()),
  };
}

export async function createProduct(data: Omit<Product, "id" | "createdAt" | "updatedAt">): Promise<Product> {
  const now = new Date();
  const docRef = await adminDb.collection("products").add({
    ...data,
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  });

  return { id: docRef.id, ...data, createdAt: now, updatedAt: now };
}

export async function updateProduct(
  id: string,
  data: Partial<Omit<Product, "id" | "createdAt" | "updatedAt">>
): Promise<void> {
  await adminDb.collection("products").doc(id).update({
    ...data,
    updatedAt: Timestamp.fromDate(new Date()),
  });
}

export async function createStockPurchaseEntry(input: {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitCost: number;
  source: "PRODUCT_CREATE" | "STOCK_REPLENISHMENT";
  createdById: string;
  createdByName: string;
}): Promise<StockPurchaseEntry> {
  const now = new Date();
  await assertFinancialMonthOpen(now);
  const nowTs = Timestamp.fromDate(now);
  const competencyMonth = toCompetencyMonth(now);
  const quantity = Math.max(0, Math.floor(Number(input.quantity)));
  const unitCost = Number(input.unitCost || 0);
  const totalCost = quantity * unitCost;

  const stockPurchaseRef = adminDb.collection("stockPurchases").doc();
  const movementRef = adminDb.collection("financialMovements").doc();
  const batch = adminDb.batch();

  batch.set(stockPurchaseRef, {
    productId: input.productId,
    productName: input.productName,
    sku: input.sku,
    quantity,
    unitCost,
    totalCost,
    source: input.source,
    createdById: input.createdById,
    createdByName: input.createdByName,
    createdAt: nowTs,
  });

  batch.set(movementRef, {
    type: "STOCK_PURCHASE",
    direction: "OUT",
    amount: totalCost,
    relatedEntity: { kind: "stockPurchase", id: stockPurchaseRef.id },
    occurredAt: nowTs,
    competencyMonth,
    createdBy: input.createdById,
    metadata: {
      source: input.source,
      productId: input.productId,
      sku: input.sku,
      quantity,
      unitCost,
    },
  });

  await batch.commit();

  return {
    id: stockPurchaseRef.id,
    productId: input.productId,
    productName: input.productName,
    sku: input.sku,
    quantity,
    unitCost,
    totalCost,
    source: input.source,
    createdById: input.createdById,
    createdByName: input.createdByName,
    createdAt: now,
  };
}

export async function deleteProduct(id: string): Promise<void> {
  await adminDb.collection("products").doc(id).delete();
}
