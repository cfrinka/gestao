import { randomUUID } from "crypto";
import type { StockAdjustmentsRepository } from "@/domains/stock-adjustments/repository";
import type { AdjustmentResult, IdempotencyReservation, StockAdjustmentRecord } from "@/domains/stock-adjustments/types";
import type { Product } from "@/lib/db-types";

export type IdempotencyEntry = {
  requestHash: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  response?: unknown;
};

/**
 * In-memory stand-in for FirestoreStockAdjustmentsRepository, used by demo mode. Replicates
 * the aggregate/per-size stock math from stock-adjustments-db.ts, but against a plain Map
 * transaction instead of a Firestore transaction.
 *
 * Mutates the SAME `products` Map instance passed into the constructor (never a private
 * copy), so a Products/Inventory screen reading from that same Map in a later request within
 * the same demo session immediately sees the adjustment reflected.
 */
export class InMemoryStockAdjustmentsRepository implements StockAdjustmentsRepository {
  constructor(
    private products: Map<string, Product>,
    private stockAdjustments: Map<string, StockAdjustmentRecord>,
    public idempotencyStore: Map<string, IdempotencyEntry>
  ) {}

  async createAdjustment(input: {
    productId: string;
    delta: number;
    sizeAdjustments: Array<{ size: string; delta: number }>;
    reason: string;
    createdById: string;
    createdByName: string;
  }): Promise<AdjustmentResult> {
    const product = this.products.get(input.productId);
    if (!product) {
      throw new Error("Product not found");
    }

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
      // Recompute the aggregate from the sizes themselves (mirrors stock-adjustments-db.ts)
      // instead of trusting a separately-supplied top-level delta to stay in sync with the
      // per-size adjustments.
      nextStock = nextSizes.reduce((sum, s) => sum + Number(s.stock || 0), 0);
    } else {
      nextStock = Math.max(0, previousStock + Math.trunc(input.delta));
    }

    const appliedDelta = nextStock - previousStock;
    const now = new Date();

    // Mutate the shared products Map in place (same instance, new value at the same key) so
    // other repositories/requests reading from this Map within the session see the update.
    this.products.set(input.productId, { ...product, stock: nextStock, sizes: nextSizes, updatedAt: now });

    const id = randomUUID();
    const record: StockAdjustmentRecord = {
      id,
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
      createdAt: now,
    };
    this.stockAdjustments.set(id, record);

    return { id, previousStock, nextStock, appliedDelta };
  }

  async listAdjustments(limit: number): Promise<StockAdjustmentRecord[]> {
    return Array.from(this.stockAdjustments.values())
      .sort((a, b) => {
        const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, limit);
  }

  async reserveIdempotency(input: {
    ownerId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<IdempotencyReservation> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotencyStore.get(key);
    if (!existing) {
      this.idempotencyStore.set(key, { requestHash: input.requestHash, status: "PROCESSING" });
      return { type: "new" };
    }
    if (existing.requestHash !== input.requestHash) return { type: "conflict" };
    if (existing.status === "COMPLETED") return { type: "completed", response: existing.response };
    if (existing.status === "PROCESSING") return { type: "in_progress" };
    existing.status = "PROCESSING";
    return { type: "new" };
  }

  async markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }): Promise<void> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotencyStore.get(key);
    if (existing) {
      existing.status = "COMPLETED";
      existing.response = input.response;
    }
  }

  async markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }): Promise<void> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotencyStore.get(key);
    if (existing) existing.status = "FAILED";
  }
}
