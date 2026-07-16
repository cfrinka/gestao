import { describe, expect, it } from "vitest";
import { ProductsService } from "./products-service";
import type { ProductsRepository } from "./repository";
import type { Product, StockPurchaseEntry } from "@/lib/db-types";
import { HttpError } from "@/lib/api/http-errors";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    name: "Camiseta",
    sku: "SKU-1",
    plusSized: false,
    costPrice: 10,
    salePrice: 20,
    stock: 0,
    sizes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakeProductsRepository implements ProductsRepository {
  products = new Map<string, Product>();
  skuIndex = new Map<string, string>();
  stockPurchaseCalls: unknown[] = [];
  idempotencyStore = new Map<string, { requestHash: string; status: "PROCESSING" | "COMPLETED" | "FAILED"; response?: unknown }>();
  failStockPurchase = false;

  seed(product: Product) {
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

  async createProduct(data: Parameters<ProductsRepository["createProduct"]>[0]): Promise<Product> {
    if (this.skuIndex.has(data.sku)) {
      throw new HttpError(400, "SKU already exists");
    }
    const product = makeProduct({ id: `product-${this.products.size + 1}`, ...data });
    this.products.set(product.id, product);
    this.skuIndex.set(product.sku, product.id);
    return product;
  }

  async updateProduct(id: string, data: Parameters<ProductsRepository["updateProduct"]>[1]): Promise<Product> {
    const existing = this.products.get(id);
    if (!existing) throw new HttpError(404, "Product not found");
    if (data.sku && data.sku !== existing.sku && this.skuIndex.has(data.sku)) {
      throw new HttpError(400, "SKU already exists");
    }
    const updated = { ...existing, ...data };
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
    return {
      id: `purchase-${this.stockPurchaseCalls.length}`,
      totalCost: input.quantity * input.unitCost,
      createdAt: new Date(),
      ...input,
    };
  }

  async reserveIdempotency(input: { ownerId: string; idempotencyKey: string; requestHash: string }) {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotencyStore.get(key);
    if (!existing) {
      this.idempotencyStore.set(key, { requestHash: input.requestHash, status: "PROCESSING" as const });
      return { type: "new" as const };
    }
    if (existing.requestHash !== input.requestHash) return { type: "conflict" as const };
    if (existing.status === "COMPLETED") return { type: "completed" as const, response: existing.response };
    if (existing.status === "PROCESSING") return { type: "in_progress" as const };
    existing.status = "PROCESSING";
    return { type: "new" as const };
  }
  async markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }) {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotencyStore.get(key);
    if (existing) {
      existing.status = "COMPLETED";
      existing.response = input.response;
    }
  }
  async markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string }) {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotencyStore.get(key);
    if (existing) existing.status = "FAILED";
  }
}

function baseCreateCommand(overrides: Record<string, unknown> = {}) {
  return {
    name: "Camiseta",
    sku: "SKU-NEW",
    costPrice: 10,
    salePrice: 20,
    stock: 0,
    sizes: [],
    plusSized: false,
    category: undefined,
    image: undefined,
    imageSource: undefined,
    idempotencyKey: "key-1",
    createdById: "user-1",
    createdByName: "Test User",
    ...overrides,
  };
}

describe("ProductsService.list / get", () => {
  it("list delegates to the repository", async () => {
    const repo = new FakeProductsRepository();
    repo.seed(makeProduct({ id: "product-1" }));
    const service = new ProductsService(repo);
    const result = await service.list();
    expect(result).toHaveLength(1);
  });

  it("get delegates to the repository", async () => {
    const repo = new FakeProductsRepository();
    repo.seed(makeProduct({ id: "product-1" }));
    const service = new ProductsService(repo);
    const result = await service.get("product-1");
    expect(result?.id).toBe("product-1");
  });
});

describe("ProductsService.create", () => {
  it("rejects missing required fields", async () => {
    const service = new ProductsService(new FakeProductsRepository());
    await expect(service.create(baseCreateCommand({ name: "" }))).rejects.toThrow(HttpError);
  });

  it("rejects a duplicate SKU", async () => {
    const repo = new FakeProductsRepository();
    repo.seed(makeProduct({ sku: "SKU-NEW" }));
    const service = new ProductsService(repo);
    await expect(service.create(baseCreateCommand())).rejects.toThrow(HttpError);
  });

  it("creates a product with zero stock without requiring an idempotency key", async () => {
    const repo = new FakeProductsRepository();
    const service = new ProductsService(repo);
    const product = await service.create(baseCreateCommand({ stock: 0, idempotencyKey: "" }));
    expect(product.sku).toBe("SKU-NEW");
    expect(repo.stockPurchaseCalls).toHaveLength(0);
  });

  it("requires an idempotency key when initial stock is positive, and does not create the product otherwise", async () => {
    const repo = new FakeProductsRepository();
    const service = new ProductsService(repo);
    await expect(service.create(baseCreateCommand({ stock: 5, idempotencyKey: "" }))).rejects.toThrow(HttpError);
    expect(await repo.getBySku("SKU-NEW")).toBeNull();
  });

  it("creates a stock purchase entry for positive initial stock", async () => {
    const repo = new FakeProductsRepository();
    const service = new ProductsService(repo);
    await service.create(baseCreateCommand({ stock: 5 }));
    expect(repo.stockPurchaseCalls).toHaveLength(1);
    expect(repo.stockPurchaseCalls[0]).toMatchObject({ quantity: 5, source: "PRODUCT_CREATE" });
  });
});

describe("ProductsService.update", () => {
  it("rejects when the product does not exist", async () => {
    const service = new ProductsService(new FakeProductsRepository());
    await expect(service.update("missing", baseCreateCommand())).rejects.toThrow(HttpError);
  });

  it("rejects renaming to an SKU already used by another product", async () => {
    const repo = new FakeProductsRepository();
    repo.seed(makeProduct({ id: "product-1", sku: "SKU-1" }));
    repo.seed(makeProduct({ id: "product-2", sku: "SKU-2" }));
    const service = new ProductsService(repo);
    await expect(
      service.update("product-2", baseCreateCommand({ sku: "SKU-1" }))
    ).rejects.toThrow(HttpError);
  });

  it("does not create a stock purchase entry when stock does not increase", async () => {
    const repo = new FakeProductsRepository();
    repo.seed(makeProduct({ id: "product-1", sku: "SKU-1", stock: 10 }));
    const service = new ProductsService(repo);
    await service.update("product-1", baseCreateCommand({ sku: "SKU-1", stock: 10, idempotencyKey: "" }));
    expect(repo.stockPurchaseCalls).toHaveLength(0);
  });

  it("creates a stock purchase entry when stock increases, requiring an idempotency key", async () => {
    const repo = new FakeProductsRepository();
    repo.seed(makeProduct({ id: "product-1", sku: "SKU-1", stock: 10 }));
    const service = new ProductsService(repo);

    await expect(
      service.update("product-1", baseCreateCommand({ sku: "SKU-1", stock: 15, idempotencyKey: "" }))
    ).rejects.toThrow(HttpError);
    expect((await repo.getById("product-1"))?.stock).toBe(10);

    await service.update("product-1", baseCreateCommand({ sku: "SKU-1", stock: 15, idempotencyKey: "key-2" }));
    expect(repo.stockPurchaseCalls).toHaveLength(1);
    expect(repo.stockPurchaseCalls[0]).toMatchObject({ quantity: 5, source: "STOCK_REPLENISHMENT" });
  });

  it("does not re-apply a stock purchase entry on an idempotent retry", async () => {
    const repo = new FakeProductsRepository();
    repo.seed(makeProduct({ id: "product-1", sku: "SKU-1", stock: 10 }));
    const service = new ProductsService(repo);
    const command = baseCreateCommand({ sku: "SKU-1", stock: 15, idempotencyKey: "same-key" });

    await service.update("product-1", command);
    expect(repo.stockPurchaseCalls).toHaveLength(1);

    await service.update("product-1", command);
    expect(repo.stockPurchaseCalls).toHaveLength(1);
  });

  it("skips creating a stock purchase entry when the idempotency reservation is already completed", async () => {
    const repo = new FakeProductsRepository();
    repo.seed(makeProduct({ id: "product-1", sku: "SKU-1", stock: 10, costPrice: 10 }));
    const requestHash = JSON.stringify({ productId: "product-1", quantity: 5, unitCost: 10, source: "STOCK_REPLENISHMENT" });
    repo.idempotencyStore.set("SKU-1:key-1", { requestHash, status: "COMPLETED", response: null });

    const service = new ProductsService(repo);
    const updated = await service.update("product-1", baseCreateCommand({ sku: "SKU-1", stock: 15, costPrice: 10, idempotencyKey: "key-1" }));

    expect(updated.stock).toBe(15);
    expect(repo.stockPurchaseCalls).toHaveLength(0);
  });

  it("rejects idempotency key reuse with a different payload as a conflict", async () => {
    const repo = new FakeProductsRepository();
    repo.seed(makeProduct({ id: "product-1", sku: "SKU-1", stock: 10, costPrice: 10 }));
    repo.idempotencyStore.set("SKU-1:key-1", { requestHash: "different-hash", status: "PROCESSING" });

    const service = new ProductsService(repo);
    await expect(
      service.update("product-1", baseCreateCommand({ sku: "SKU-1", stock: 15, costPrice: 10, idempotencyKey: "key-1" }))
    ).rejects.toThrow(HttpError);
  });

  it("returns 409 when the same idempotency key is already being processed", async () => {
    const repo = new FakeProductsRepository();
    repo.seed(makeProduct({ id: "product-1", sku: "SKU-1", stock: 10, costPrice: 10 }));
    const requestHash = JSON.stringify({ productId: "product-1", quantity: 5, unitCost: 10, source: "STOCK_REPLENISHMENT" });
    repo.idempotencyStore.set("SKU-1:key-1", { requestHash, status: "PROCESSING" });

    const service = new ProductsService(repo);
    await expect(
      service.update("product-1", baseCreateCommand({ sku: "SKU-1", stock: 15, costPrice: 10, idempotencyKey: "key-1" }))
    ).rejects.toThrow(HttpError);
  });

  it("marks idempotency failed and rethrows when creating the stock purchase entry fails", async () => {
    const repo = new FakeProductsRepository();
    repo.seed(makeProduct({ id: "product-1", sku: "SKU-1", stock: 10, costPrice: 10 }));
    repo.failStockPurchase = true;

    const service = new ProductsService(repo);
    await expect(
      service.update("product-1", baseCreateCommand({ sku: "SKU-1", stock: 15, costPrice: 10, idempotencyKey: "key-1" }))
    ).rejects.toThrow("stock purchase write failed");
    expect(repo.idempotencyStore.get("SKU-1:key-1")?.status).toBe("FAILED");
  });
});

describe("ProductsService.remove", () => {
  it("rejects when the product does not exist", async () => {
    const service = new ProductsService(new FakeProductsRepository());
    await expect(service.remove("missing")).rejects.toThrow(HttpError);
  });

  it("deletes an existing product", async () => {
    const repo = new FakeProductsRepository();
    repo.seed(makeProduct({ id: "product-1" }));
    const service = new ProductsService(repo);
    await service.remove("product-1");
    expect(await repo.getById("product-1")).toBeNull();
  });
});
