import { describe, expect, it } from "vitest";
import { ProductsService } from "./products-service";
import { InMemoryProductsRepository } from "./in-memory-products-repository";
import type { Product } from "@/lib/db-types";
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

function makeRepo(): InMemoryProductsRepository {
  return new InMemoryProductsRepository(new Map(), new Map(), new Map(), new Map());
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
    const repo = makeRepo();
    repo.seed(makeProduct({ id: "product-1" }));
    const service = new ProductsService(repo);
    const result = await service.list();
    expect(result).toHaveLength(1);
  });

  it("get delegates to the repository", async () => {
    const repo = makeRepo();
    repo.seed(makeProduct({ id: "product-1" }));
    const service = new ProductsService(repo);
    const result = await service.get("product-1");
    expect(result?.id).toBe("product-1");
  });
});

describe("ProductsService.create", () => {
  it("rejects missing required fields", async () => {
    const service = new ProductsService(makeRepo());
    await expect(service.create(baseCreateCommand({ name: "" }))).rejects.toThrow(HttpError);
  });

  it("rejects a duplicate SKU", async () => {
    const repo = makeRepo();
    repo.seed(makeProduct({ sku: "SKU-NEW" }));
    const service = new ProductsService(repo);
    await expect(service.create(baseCreateCommand())).rejects.toThrow(HttpError);
  });

  it("creates a product with zero stock without requiring an idempotency key", async () => {
    const repo = makeRepo();
    const service = new ProductsService(repo);
    const product = await service.create(baseCreateCommand({ stock: 0, idempotencyKey: "" }));
    expect(product.sku).toBe("SKU-NEW");
    expect(repo.stockPurchaseCalls).toHaveLength(0);
  });

  it("requires an idempotency key when initial stock is positive, and does not create the product otherwise", async () => {
    const repo = makeRepo();
    const service = new ProductsService(repo);
    await expect(service.create(baseCreateCommand({ stock: 5, idempotencyKey: "" }))).rejects.toThrow(HttpError);
    expect(await repo.getBySku("SKU-NEW")).toBeNull();
  });

  it("creates a stock purchase entry for positive initial stock", async () => {
    const repo = makeRepo();
    const service = new ProductsService(repo);
    await service.create(baseCreateCommand({ stock: 5 }));
    expect(repo.stockPurchaseCalls).toHaveLength(1);
    expect(repo.stockPurchaseCalls[0]).toMatchObject({ quantity: 5, source: "PRODUCT_CREATE" });
  });
});

describe("ProductsService.update", () => {
  it("rejects when the product does not exist", async () => {
    const service = new ProductsService(makeRepo());
    await expect(service.update("missing", baseCreateCommand())).rejects.toThrow(HttpError);
  });

  it("rejects renaming to an SKU already used by another product", async () => {
    const repo = makeRepo();
    repo.seed(makeProduct({ id: "product-1", sku: "SKU-1" }));
    repo.seed(makeProduct({ id: "product-2", sku: "SKU-2" }));
    const service = new ProductsService(repo);
    await expect(
      service.update("product-2", baseCreateCommand({ sku: "SKU-1" }))
    ).rejects.toThrow(HttpError);
  });

  it("does not create a stock purchase entry when stock does not increase", async () => {
    const repo = makeRepo();
    repo.seed(makeProduct({ id: "product-1", sku: "SKU-1", stock: 10 }));
    const service = new ProductsService(repo);
    await service.update("product-1", baseCreateCommand({ sku: "SKU-1", stock: 10, idempotencyKey: "" }));
    expect(repo.stockPurchaseCalls).toHaveLength(0);
  });

  it("creates a stock purchase entry when stock increases, requiring an idempotency key", async () => {
    const repo = makeRepo();
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
    const repo = makeRepo();
    repo.seed(makeProduct({ id: "product-1", sku: "SKU-1", stock: 10 }));
    const service = new ProductsService(repo);
    const command = baseCreateCommand({ sku: "SKU-1", stock: 15, idempotencyKey: "same-key" });

    await service.update("product-1", command);
    expect(repo.stockPurchaseCalls).toHaveLength(1);

    await service.update("product-1", command);
    expect(repo.stockPurchaseCalls).toHaveLength(1);
  });

  it("skips creating a stock purchase entry when the idempotency reservation is already completed", async () => {
    const repo = makeRepo();
    repo.seed(makeProduct({ id: "product-1", sku: "SKU-1", stock: 10, costPrice: 10 }));
    const requestHash = JSON.stringify({ productId: "product-1", quantity: 5, unitCost: 10, source: "STOCK_REPLENISHMENT" });
    repo.idempotencyStore.set("SKU-1:key-1", { requestHash, status: "COMPLETED", response: null });

    const service = new ProductsService(repo);
    const updated = await service.update("product-1", baseCreateCommand({ sku: "SKU-1", stock: 15, costPrice: 10, idempotencyKey: "key-1" }));

    expect(updated.stock).toBe(15);
    expect(repo.stockPurchaseCalls).toHaveLength(0);
  });

  it("rejects idempotency key reuse with a different payload as a conflict", async () => {
    const repo = makeRepo();
    repo.seed(makeProduct({ id: "product-1", sku: "SKU-1", stock: 10, costPrice: 10 }));
    repo.idempotencyStore.set("SKU-1:key-1", { requestHash: "different-hash", status: "PROCESSING" });

    const service = new ProductsService(repo);
    await expect(
      service.update("product-1", baseCreateCommand({ sku: "SKU-1", stock: 15, costPrice: 10, idempotencyKey: "key-1" }))
    ).rejects.toThrow(HttpError);
  });

  it("returns 409 when the same idempotency key is already being processed", async () => {
    const repo = makeRepo();
    repo.seed(makeProduct({ id: "product-1", sku: "SKU-1", stock: 10, costPrice: 10 }));
    const requestHash = JSON.stringify({ productId: "product-1", quantity: 5, unitCost: 10, source: "STOCK_REPLENISHMENT" });
    repo.idempotencyStore.set("SKU-1:key-1", { requestHash, status: "PROCESSING" });

    const service = new ProductsService(repo);
    await expect(
      service.update("product-1", baseCreateCommand({ sku: "SKU-1", stock: 15, costPrice: 10, idempotencyKey: "key-1" }))
    ).rejects.toThrow(HttpError);
  });

  it("marks idempotency failed and rethrows when creating the stock purchase entry fails", async () => {
    const repo = makeRepo();
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
    const service = new ProductsService(makeRepo());
    await expect(service.remove("missing")).rejects.toThrow(HttpError);
  });

  it("deletes an existing product", async () => {
    const repo = makeRepo();
    repo.seed(makeProduct({ id: "product-1" }));
    const service = new ProductsService(repo);
    await service.remove("product-1");
    expect(await repo.getById("product-1")).toBeNull();
  });
});
