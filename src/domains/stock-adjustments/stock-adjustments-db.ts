import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { AdjustmentResult, StockAdjustmentRecord } from "@/domains/stock-adjustments/types";

export async function createAdjustment(input: {
  productId: string;
  delta: number;
  sizeAdjustments: Array<{ size: string; delta: number }>;
  reason: string;
  createdById: string;
  createdByName: string;
}): Promise<AdjustmentResult> {
  const productRef = adminDb.collection("products").doc(input.productId);
  const adjustmentRef = adminDb.collection("stockAdjustments").doc();

  const result = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(productRef);
    if (!snap.exists) {
      throw new Error("Product not found");
    }
    const product = snap.data() as {
      name?: string;
      sku?: string;
      stock?: number;
      sizes?: Array<{ size: string; stock: number }>;
    };

    const previousStock = Number(product.stock || 0);
    const previousSizes = Array.isArray(product.sizes) ? product.sizes : [];

    let nextSizes = previousSizes;
    let nextStock: number;
    const appliedSizeAdjustments: Array<{ size: string; delta: number; before: number; after: number }> = [];

    if (input.sizeAdjustments.length > 0) {
      const sizeMap = new Map(previousSizes.map((s) => [s.size, Number(s.stock || 0)]));
      for (const adj of input.sizeAdjustments) {
        const sizeKey = String(adj.size || "").trim();
        const sizeDelta = Math.trunc(Number(adj.delta || 0));
        if (!sizeKey || sizeDelta === 0) continue;
        const before = sizeMap.get(sizeKey) || 0;
        const after = Math.max(0, before + sizeDelta);
        sizeMap.set(sizeKey, after);
        appliedSizeAdjustments.push({ size: sizeKey, delta: after - before, before, after });
      }
      nextSizes = Array.from(sizeMap.entries()).map(([size, stock]) => ({ size, stock }));
      // Recompute the aggregate from the sizes themselves (same pattern used by
      // checkout/exchanges/cancelOrder) instead of trusting a separately-supplied top-level
      // delta to stay in sync with the per-size adjustments.
      nextStock = nextSizes.reduce((sum, s) => sum + Number(s.stock || 0), 0);
    } else {
      nextStock = Math.max(0, previousStock + Math.trunc(input.delta));
    }

    const appliedDelta = nextStock - previousStock;

    tx.update(productRef, {
      stock: nextStock,
      sizes: nextSizes,
      updatedAt: Timestamp.fromDate(new Date()),
    });

    tx.set(adjustmentRef, {
      productId: input.productId,
      productName: String(product.name || ""),
      sku: String(product.sku || ""),
      previousStock,
      nextStock,
      delta: appliedDelta,
      sizeAdjustments: appliedSizeAdjustments,
      reason: input.reason,
      createdById: input.createdById,
      createdByName: input.createdByName,
      createdAt: Timestamp.fromDate(new Date()),
    });

    return { previousStock, nextStock, appliedDelta };
  });

  return { id: adjustmentRef.id, ...result };
}

export async function listAdjustments(limit: number): Promise<StockAdjustmentRecord[]> {
  const snapshot = await adminDb.collection("stockAdjustments").orderBy("createdAt", "desc").limit(limit).get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate?.() || new Date(),
    } as unknown as StockAdjustmentRecord;
  });
}
