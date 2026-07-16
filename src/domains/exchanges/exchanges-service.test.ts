import { describe, expect, it, vi } from "vitest";
import { ExchangesService } from "./exchanges-service";
import type { ExchangesRepository } from "./repository";
import type { CreateExchangeCommand, IdempotencyReservation } from "./types";
import type { ExchangeRecord } from "@/lib/db-types";
import { HttpError } from "@/lib/api/http-errors";

class FakeExchangesRepository implements ExchangesRepository {
  idempotencyStore = new Map<string, { requestHash: string; status: "PROCESSING" | "COMPLETED" | "FAILED"; response?: unknown }>();
  createExchangeMock = vi.fn(
    async (input: Parameters<ExchangesRepository["createExchange"]>[0]): Promise<ExchangeRecord> => ({
      id: "exchange-1",
      documentNumber: "AJUSTE-1",
      items: [],
      totalInValue: 0,
      totalOutValue: 90,
      discountAmount: Number(input.discountAmount || 0),
      difference: 90 - Number(input.discountAmount || 0),
      cashInAmount: 90 - Number(input.discountAmount || 0),
      createdById: input.createdById,
      createdByName: input.createdByName,
      createdAt: new Date(),
    })
  );
  consumeDiscountAuthorizationMock = vi.fn(async (_userId: string) => false);
  getOpenCashRegisterIdMock = vi.fn(async (_userId: string): Promise<string | undefined> => undefined);
  getProductSalePricesMock = vi.fn(async (productIds: string[]) => {
    const prices = new Map<string, number>();
    for (const id of productIds) {
      if (id === "cheap") prices.set(id, 10);
      if (id === "expensive") prices.set(id, 100);
    }
    return prices;
  });

  async listExchanges() {
    return [];
  }

  async reserveIdempotency(input: { ownerId: string; idempotencyKey: string; requestHash: string }): Promise<IdempotencyReservation> {
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

  async getOpenCashRegisterId(userId: string) {
    return this.getOpenCashRegisterIdMock(userId);
  }
  async getProductSalePrices(productIds: string[]) {
    return this.getProductSalePricesMock(productIds);
  }
  async consumeDiscountAuthorization(userId: string) {
    return this.consumeDiscountAuthorizationMock(userId);
  }
  async createExchange(input: Parameters<ExchangesRepository["createExchange"]>[0]) {
    return this.createExchangeMock(input);
  }
}

// cheap ($10, IN) vs expensive ($100, OUT) -> grossDifference = 90, 10% cap = 9
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
    const repo = new FakeExchangesRepository();
    const service = new ExchangesService(repo);
    const spy = vi.spyOn(repo, "listExchanges");
    await service.list({ limit: 10 });
    expect(spy).toHaveBeenCalledWith({ limit: 10 });
  });
});

describe("ExchangesService", () => {
  it("rejects a missing idempotency key", async () => {
    const service = new ExchangesService(new FakeExchangesRepository());
    await expect(service.create(baseCommand({ idempotencyKey: "" }))).rejects.toThrow(HttpError);
  });

  it("rejects an empty item list", async () => {
    const service = new ExchangesService(new FakeExchangesRepository());
    await expect(service.create(baseCommand({ items: [] }))).rejects.toThrow(HttpError);
  });

  it("rejects a role that isn't ADMIN or CASHIER", async () => {
    const service = new ExchangesService(new FakeExchangesRepository());
    await expect(service.create(baseCommand({ userRole: "GUEST" }))).rejects.toThrow(HttpError);
  });

  it("caps a cashier's discount to 10% of the estimated gross difference without authorization", async () => {
    const repo = new FakeExchangesRepository();
    const service = new ExchangesService(repo);
    await service.create(baseCommand({ discountAmount: 50 }));
    expect(repo.createExchangeMock).toHaveBeenCalledWith(expect.objectContaining({ discountAmount: 9 }));
  });

  it("honors the full discount for a cashier with a valid authorization grant", async () => {
    const repo = new FakeExchangesRepository();
    repo.consumeDiscountAuthorizationMock.mockResolvedValue(true);
    const service = new ExchangesService(repo);
    await service.create(baseCommand({ discountAmount: 50 }));
    expect(repo.createExchangeMock).toHaveBeenCalledWith(expect.objectContaining({ discountAmount: 50 }));
  });

  it("never caps an ADMIN's discount and never consumes a grant for admins", async () => {
    const repo = new FakeExchangesRepository();
    const service = new ExchangesService(repo);
    await service.create(baseCommand({ discountAmount: 50, userRole: "ADMIN" }));
    expect(repo.createExchangeMock).toHaveBeenCalledWith(expect.objectContaining({ discountAmount: 50 }));
    expect(repo.consumeDiscountAuthorizationMock).not.toHaveBeenCalled();
  });

  it("does not cap or require authorization when the requested discount is already under the cap", async () => {
    const repo = new FakeExchangesRepository();
    const service = new ExchangesService(repo);
    await service.create(baseCommand({ discountAmount: 5 }));
    expect(repo.createExchangeMock).toHaveBeenCalledWith(expect.objectContaining({ discountAmount: 5 }));
    expect(repo.consumeDiscountAuthorizationMock).not.toHaveBeenCalled();
  });

  it("returns the cached response on a completed retry without creating a second exchange", async () => {
    const repo = new FakeExchangesRepository();
    const service = new ExchangesService(repo);
    const command = baseCommand();

    const first = await service.create(command);
    expect(first.status).toBe(201);
    expect(repo.createExchangeMock).toHaveBeenCalledTimes(1);

    const second = await service.create(command);
    expect(second.status).toBe(200);
    expect(repo.createExchangeMock).toHaveBeenCalledTimes(1);
    expect((second.body as ExchangeRecord).id).toBe((first.body as ExchangeRecord).id);
  });

  it("rejects idempotency key reuse with a different payload", async () => {
    const repo = new FakeExchangesRepository();
    const service = new ExchangesService(repo);
    await service.create(baseCommand({ idempotencyKey: "conflict-key" }));
    await expect(
      service.create(baseCommand({ idempotencyKey: "conflict-key", discountAmount: 5 }))
    ).rejects.toThrow(HttpError);
  });

  it("returns 409 when the same idempotency key is already being processed", async () => {
    const repo = new FakeExchangesRepository();
    const command = baseCommand({ idempotencyKey: "in-progress-key" });
    const requestHash = JSON.stringify({
      customerName: "",
      notes: "",
      paymentMethod: command.paymentMethod,
      discountAmount: 0,
      items: command.items,
      userId: command.userId,
    });
    repo.idempotencyStore.set("user-1:in-progress-key", { requestHash, status: "PROCESSING" });

    const service = new ExchangesService(repo);
    const result = await service.create(command);
    expect(result.status).toBe(409);
  });

  it("marks idempotency failed and rethrows when creating the exchange fails", async () => {
    const repo = new FakeExchangesRepository();
    repo.createExchangeMock.mockRejectedValueOnce(new Error("stock write failed"));
    const service = new ExchangesService(repo);

    await expect(service.create(baseCommand({ idempotencyKey: "fail-key" }))).rejects.toThrow("stock write failed");
    expect(repo.idempotencyStore.get("user-1:fail-key")?.status).toBe("FAILED");
  });
});
