import { describe, expect, it, vi } from "vitest";
import { ExchangesService } from "./exchanges-service";
import { InMemoryExchangesRepository, type IdempotencyEntry } from "./in-memory-exchanges-repository";
import type { CreateExchangeCommand } from "./types";
import type { CashRegister, ExchangeRecord, Product } from "@/lib/db-types";
import { HttpError } from "@/lib/api/http-errors";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    name: "Produto",
    sku: "SKU-1",
    costPrice: 5,
    salePrice: 10,
    stock: 100,
    sizes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRepo() {
  const exchanges = new Map<string, ExchangeRecord>();
  // cheap ($10, IN) vs expensive ($100, OUT) -> grossDifference = 90, 10% cap = 9
  const products = new Map<string, Product>([
    ["cheap", makeProduct({ id: "cheap", sku: "CHEAP", salePrice: 10 })],
    ["expensive", makeProduct({ id: "expensive", sku: "EXPENSIVE", salePrice: 100 })],
  ]);
  const cashRegisters = new Map<string, CashRegister>();
  const idempotency = new Map<string, IdempotencyEntry>();
  const discountAuthorizations = new Set<string>();
  const repo = new InMemoryExchangesRepository(exchanges, products, cashRegisters, idempotency, discountAuthorizations);
  return { repo, exchanges, products, cashRegisters, idempotency, discountAuthorizations };
}

function baseCommand(overrides: Partial<CreateExchangeCommand> = {}): CreateExchangeCommand {
  return {
    userId: "user-1",
    userRole: "CASHIER",
    userDisplayName: "Test User",
    paymentMethod: "cash",
    discountAmount: 0,
    items: [
      { productId: "cheap", size: "", quantity: 1, direction: "IN" },
      { productId: "expensive", size: "", quantity: 1, direction: "OUT" },
    ],
    idempotencyKey: "ex-key-1",
    ...overrides,
  };
}

describe("ExchangesService.list", () => {
  it("delegates to the repository", async () => {
    const { repo } = makeRepo();
    const service = new ExchangesService(repo);
    const spy = vi.spyOn(repo, "listExchanges");
    await service.list({ limit: 10 });
    expect(spy).toHaveBeenCalledWith({ limit: 10 });
  });
});

describe("ExchangesService", () => {
  it("rejects a missing idempotency key", async () => {
    const { repo } = makeRepo();
    const service = new ExchangesService(repo);
    await expect(service.create(baseCommand({ idempotencyKey: "" }))).rejects.toThrow(HttpError);
  });

  it("rejects an empty item list", async () => {
    const { repo } = makeRepo();
    const service = new ExchangesService(repo);
    await expect(service.create(baseCommand({ items: [] }))).rejects.toThrow(HttpError);
  });

  it("rejects a role that isn't ADMIN or CASHIER", async () => {
    const { repo } = makeRepo();
    const service = new ExchangesService(repo);
    await expect(service.create(baseCommand({ userRole: "GUEST" }))).rejects.toThrow(HttpError);
  });

  it("caps a cashier's discount to 10% of the estimated gross difference without authorization", async () => {
    const { repo } = makeRepo();
    const service = new ExchangesService(repo);
    const spy = vi.spyOn(repo, "createExchange");
    await service.create(baseCommand({ discountAmount: 50 }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ discountAmount: 9 }));
  });

  it("honors the full discount for a cashier with a valid authorization grant", async () => {
    const { repo, discountAuthorizations } = makeRepo();
    discountAuthorizations.add("user-1");
    const service = new ExchangesService(repo);
    const spy = vi.spyOn(repo, "createExchange");
    await service.create(baseCommand({ discountAmount: 50 }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ discountAmount: 50 }));
  });

  it("never caps an ADMIN's discount and never consumes a grant for admins", async () => {
    const { repo } = makeRepo();
    const service = new ExchangesService(repo);
    const createSpy = vi.spyOn(repo, "createExchange");
    const consumeSpy = vi.spyOn(repo, "consumeDiscountAuthorization");
    await service.create(baseCommand({ discountAmount: 50, userRole: "ADMIN" }));
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ discountAmount: 50 }));
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("does not cap or require authorization when the requested discount is already under the cap", async () => {
    const { repo } = makeRepo();
    const service = new ExchangesService(repo);
    const createSpy = vi.spyOn(repo, "createExchange");
    const consumeSpy = vi.spyOn(repo, "consumeDiscountAuthorization");
    await service.create(baseCommand({ discountAmount: 5 }));
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ discountAmount: 5 }));
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("returns the cached response on a completed retry without creating a second exchange", async () => {
    const { repo } = makeRepo();
    const service = new ExchangesService(repo);
    const spy = vi.spyOn(repo, "createExchange");
    const command = baseCommand();

    const first = await service.create(command);
    expect(first.status).toBe(201);
    expect(spy).toHaveBeenCalledTimes(1);

    const second = await service.create(command);
    expect(second.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect((second.body as ExchangeRecord).id).toBe((first.body as ExchangeRecord).id);
  });

  it("rejects idempotency key reuse with a different payload", async () => {
    const { repo } = makeRepo();
    const service = new ExchangesService(repo);
    await service.create(baseCommand({ idempotencyKey: "conflict-key" }));
    await expect(
      service.create(baseCommand({ idempotencyKey: "conflict-key", discountAmount: 5 }))
    ).rejects.toThrow(HttpError);
  });

  it("returns 409 when the same idempotency key is already being processed", async () => {
    const { repo, idempotency } = makeRepo();
    const command = baseCommand({ idempotencyKey: "in-progress-key" });
    const requestHash = JSON.stringify({
      customerName: "",
      notes: "",
      paymentMethod: command.paymentMethod,
      discountAmount: 0,
      items: command.items,
      userId: command.userId,
    });
    idempotency.set("user-1:in-progress-key", { requestHash, status: "PROCESSING" });

    const service = new ExchangesService(repo);
    const result = await service.create(command);
    expect(result.status).toBe(409);
  });

  it("marks idempotency failed and rethrows when creating the exchange fails", async () => {
    const { repo, idempotency } = makeRepo();
    vi.spyOn(repo, "createExchange").mockRejectedValueOnce(new Error("stock write failed"));
    const service = new ExchangesService(repo);

    await expect(service.create(baseCommand({ idempotencyKey: "fail-key" }))).rejects.toThrow("stock write failed");
    expect(idempotency.get("user-1:fail-key")?.status).toBe("FAILED");
  });
});
