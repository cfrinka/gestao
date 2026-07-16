import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { Product, StockPurchaseEntry } from "@/lib/db-types";
import type { ProductCreateInput, ProductUpdateInput } from "@/domains/products/types";
import { convertTimestamp } from "@/domains/shared/firestore-serializers";
import { HttpError } from "@/lib/api/http-errors";

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

// A marker doc at a natural key (sku) makes "is this SKU already used" a race-safe
// tx.create instead of a separate check-then-act query — two concurrent creates (or a
// concurrent create + sku-changing update) for the same SKU can no longer both pass.
// Note: this only protects SKUs that have gone through createProduct or a sku-changing
// updateProduct since this index was introduced — pre-existing products won't have a
// marker until they're next touched by one of those paths.
function skuIndexRef(sku: string) {
  return adminDb.collection("skuIndex").doc(sku);
}

function toProduct(id: string, data: FirebaseFirestore.DocumentData): Product {
  return {
    id,
    plusSized: data?.plusSized === true,
    ...convertTimestamp<Omit<Product, "id">>(data),
  };
}

export async function getProducts(): Promise<Product[]> {
  const snapshot = await adminDb.collection("products").orderBy("name").get();
  return snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));
}

export async function getProduct(id: string): Promise<Product | null> {
  const doc = await adminDb.collection("products").doc(id).get();
  if (!doc.exists) return null;
  return toProduct(doc.id, doc.data()!);
}

export async function getProductBySku(sku: string): Promise<Product | null> {
  const snapshot = await adminDb.collection("products").where("sku", "==", sku).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return toProduct(doc.id, doc.data());
}

export async function createProduct(data: ProductCreateInput): Promise<Product> {
  const now = new Date();
  const nowTs = Timestamp.fromDate(now);
  const productRef = adminDb.collection("products").doc();
  const skuRef = skuIndexRef(data.sku);

  // Firestore rejects explicit `undefined` field values (e.g. a product created with no
  // category or no image) — drop those keys rather than writing them.
  const sanitizedData = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as typeof data;

  await adminDb.runTransaction(async (tx) => {
    const skuSnap = await tx.get(skuRef);
    if (skuSnap.exists) {
      throw new HttpError(400, "SKU already exists");
    }

    tx.create(skuRef, { productId: productRef.id, sku: data.sku });
    tx.set(productRef, { ...sanitizedData, createdAt: nowTs, updatedAt: nowTs });
  });

  return { id: productRef.id, ...data, createdAt: now, updatedAt: now };
}

export async function updateProduct(id: string, data: ProductUpdateInput): Promise<Product> {
  const productRef = adminDb.collection("products").doc(id);
  const now = new Date();
  const nowTs = Timestamp.fromDate(now);

  // Firestore rejects explicit `undefined` field values. A resolved field (e.g. a
  // product with no category) can legitimately be undefined, so drop those keys instead
  // of writing them — omitting a key from an update() payload already means "leave it
  // unchanged", which is the correct semantics here.
  const sanitizedData = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as typeof data;

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(productRef);
    if (!snap.exists) {
      throw new HttpError(404, "Product not found");
    }

    const existingSku = snap.data()?.sku as string | undefined;
    const skuChanged = Boolean(data.sku && data.sku !== existingSku);
    const nextSkuRef = skuChanged ? skuIndexRef(data.sku!) : null;

    if (nextSkuRef) {
      const nextSkuSnap = await tx.get(nextSkuRef);
      if (nextSkuSnap.exists) {
        throw new HttpError(400, "SKU already exists");
      }
    }

    tx.update(productRef, { ...sanitizedData, updatedAt: nowTs });

    if (nextSkuRef) {
      tx.create(nextSkuRef, { productId: id, sku: data.sku });
      if (existingSku) {
        tx.delete(skuIndexRef(existingSku));
      }
    }
  });

  const updatedDoc = await productRef.get();
  return toProduct(updatedDoc.id, updatedDoc.data()!);
}

export async function deleteProduct(id: string): Promise<void> {
  const productRef = adminDb.collection("products").doc(id);

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(productRef);
    if (!snap.exists) return;

    const sku = snap.data()?.sku as string | undefined;
    tx.delete(productRef);
    if (sku) {
      tx.delete(skuIndexRef(sku));
    }
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
