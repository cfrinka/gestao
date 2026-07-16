import { randomUUID } from "crypto";
import { HttpError } from "@/lib/api/http-errors";
import type { ProductsRepository } from "@/domains/products/repository";
import type { IdempotencyReservation, ProductCreateInput, ProductUpdateInput } from "@/domains/products/types";
import type { Product, StockPurchaseEntry } from "@/lib/db-types";

export type IdempotencyEntry = {
  requestHash: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  response?: unknown;
};

/**
 * In-memory stand-in for FirestoreProductsRepository, used by demo mode. Instances are
 * constructed fresh per request (see the demo repository factory), but the Maps passed into
 * the constructor are the same session-scoped Maps from src/lib/demo/demo-store.ts, so writes
 * in one request are visible on the next request in the same demo session.
 *
 * Kept framework-agnostic on purpose: no import of demo-store/demo-context here, just the
 * plain Maps the caller hands in.
 */
export class InMemoryProductsRepository implements ProductsRepository {
  // Test-only instrumentation carried over from the original FakeProductsRepository test
  // double (products-service.test.ts) so its assertions keep working unchanged. Unused
  // during real demo traffic.
  stockPurchaseCalls: unknown[] = [];
  failStockPurchase = false;

  constructor(
    private products: Map<string, Product>,
    private skuIndex: Map<string, string>,
    public idempotencyStore: Map<string, IdempotencyEntry>,
    private stockPurchases: Map<string, StockPurchaseEntry>
  ) {}

  seed(product: Product): void {
    this.products.set(product.id, product);
    this.skuIndex.set(product.sku, product.id);
  }

  async getAll(): Promise<Product[]> {
    return Array.from(this.products.values());
  }

  async getById(id: string): Promise<Product | null> {
    return this.products.get(id) || null;
  }

  async getBySku(sku: string): Promise<Product | null> {
    const id = this.skuIndex.get(sku);
    return id ? this.products.get(id) || null : null;
  }

  async createProduct(data: ProductCreateInput): Promise<Product> {
    if (this.skuIndex.has(data.sku)) {
      throw new HttpError(400, "SKU already exists");
    }
    const now = new Date();
    const product: Product = { id: randomUUID(), ...data, createdAt: now, updatedAt: now };
    this.products.set(product.id, product);
    this.skuIndex.set(product.sku, product.id);
    return product;
  }

  async updateProduct(id: string, data: ProductUpdateInput): Promise<Product> {
    const existing = this.products.get(id);
    if (!existing) throw new HttpError(404, "Product not found");
    if (data.sku && data.sku !== existing.sku && this.skuIndex.has(data.sku)) {
      throw new HttpError(400, "SKU already exists");
    }
    const updated: Product = { ...existing, ...data, updatedAt: new Date() };
    if (data.sku && data.sku !== existing.sku) {
      this.skuIndex.delete(existing.sku);
      this.skuIndex.set(data.sku, id);
    }
    this.products.set(id, updated);
    return updated;
  }

  async deleteProduct(id: string): Promise<void> {
    const existing = this.products.get(id);
    if (existing) this.skuIndex.delete(existing.sku);
    this.products.delete(id);
  }

  async createStockPurchaseEntry(
    input: Parameters<ProductsRepository["createStockPurchaseEntry"]>[0]
  ): Promise<StockPurchaseEntry> {
    if (this.failStockPurchase) {
      throw new Error("stock purchase write failed");
    }
    this.stockPurchaseCalls.push(input);
    const entry: StockPurchaseEntry = {
      id: randomUUID(),
      totalCost: input.quantity * input.unitCost,
      createdAt: new Date(),
      ...input,
    };
    this.stockPurchases.set(entry.id, entry);
    return entry;
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
