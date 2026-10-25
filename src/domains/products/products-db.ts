import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { Product, StockPurchaseEntry } from "@/lib/db-types";
import type { ProductCreateInput, ProductStockEditOptions, ProductUpdateInput } from "@/domains/products/types";
import { applyStockEdit } from "@/domains/products/stock-edit";
import { convertTimestamp } from "@/domains/shared/firestore-serializers";
import { HttpError, closedMonthError } from "@/lib/api/http-errors";
import { toCompetencyMonth } from "@/lib/dates";

async function assertFinancialMonthOpen(date: Date): Promise<void> {
  const month = toCompetencyMonth(date);
  const closure = await adminDb.collection("financialClosures").doc(month).get();
  if (closure.exists) {
    throw closedMonthError(month);
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
    sizeType: data?.sizeType === "numeric" ? "numeric" : "letter",
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

/** Several products by id in batched reads (missing ids are simply absent from the map). */
export async function getProductsByIds(ids: string[]): Promise<Map<string, Product>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const result = new Map<string, Product>();
  for (let i = 0; i < unique.length; i += 300) {
    const refs = unique.slice(i, i + 300).map((id) => adminDb.collection("products").doc(id));
    const docs = await adminDb.getAll(...refs);
    for (const doc of docs) {
      if (doc.exists) result.set(doc.id, toProduct(doc.id, doc.data()!));
    }
  }
  return result;
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
      throw new HttpError(400, "Já existe um produto com este código (SKU)");
    }

    tx.create(skuRef, { productId: productRef.id, sku: data.sku });
    tx.set(productRef, { ...sanitizedData, createdAt: nowTs, updatedAt: nowTs });
  });

  return { id: productRef.id, ...data, createdAt: now, updatedAt: now };
}

export async function updateProduct(
  id: string,
  data: ProductUpdateInput,
  stockEdit?: ProductStockEditOptions
): Promise<Product> {
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
      throw new HttpError(404, "Produto não encontrado");
    }

    const existingSku = snap.data()?.sku as string | undefined;
    const skuChanged = Boolean(data.sku && data.sku !== existingSku);
    const nextSkuRef = skuChanged ? skuIndexRef(data.sku!) : null;

    if (nextSkuRef) {
      const nextSkuSnap = await tx.get(nextSkuRef);
      if (nextSkuSnap.exists) {
        throw new HttpError(400, "Já existe um produto com este código (SKU)");
      }
    }

    if (stockEdit) {
      // The form's stock is applied as a difference over the stock as it is right now, inside
      // this transaction — a sale made while the form was open stays sold.
      const current = snap.data() as { name?: string; sku?: string; stock?: number; sizes?: Array<{ size: string; stock: number }> };
      const applied = applyStockEdit(
        { stock: Number(current.stock || 0), sizes: Array.isArray(current.sizes) ? current.sizes : [] },
        stockEdit.edit
      );
      const { stock: _ignoredStock, sizes: _ignoredSizes, ...rest } = sanitizedData;
      tx.update(productRef, {
        ...rest,
        stock: applied.stock,
        ...(applied.sizes ? { sizes: applied.sizes } : {}),
        updatedAt: nowTs,
      });

      const previousStock = Number(current.stock || 0);
      if (stockEdit.recordCorrection && applied.stock !== previousStock) {
        tx.set(adminDb.collection("stockAdjustments").doc(), {
          productId: id,
          productName: String(data.name || current.name || ""),
          sku: String(data.sku || current.sku || ""),
          previousStock,
          nextStock: applied.stock,
          delta: applied.stock - previousStock,
          sizeAdjustments: applied.changes.filter((change) => change.size),
          reason: "Correção no cadastro do produto",
          createdById: stockEdit.actorId,
          createdByName: stockEdit.actorName,
          createdAt: nowTs,
        });
      }
    } else {
      tx.update(productRef, { ...sanitizedData, updatedAt: nowTs });
    }

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
