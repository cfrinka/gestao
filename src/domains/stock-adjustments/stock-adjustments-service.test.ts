import { describe, expect, it, vi } from "vitest";
import { StockAdjustmentsService } from "./stock-adjustments-service";
import type { StockAdjustmentsRepository } from "./repository";
import type { AdjustmentResult, IdempotencyReservation, StockAdjustmentRecord } from "./types";
import { HttpError } from "@/lib/api/http-errors";

class FakeStockAdjustmentsRepository implements StockAdjustmentsRepository {
  idempotencyStore = new Map<string, { requestHash: string; status: "PROCESSING" | "COMPLETED" | "FAILED"; response?: unknown }>();

  createAdjustmentMock = vi.fn(
    async (_input: Parameters<StockAdjustmentsRepository["createAdjustment"]>[0]): Promise<AdjustmentResult> => ({
      id: "adj-1",
      previousStock: 10,
      nextStock: 15,
      appliedDelta: 5,
    })
  );
  listAdjustmentsMock = vi.fn(async (_limit: number): Promise<StockAdjustmentRecord[]> => []);

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

  async createAdjustment(input: Parameters<StockAdjustmentsRepository["createAdjustment"]>[0]) {
    return this.createAdjustmentMock(input);
  }
  async listAdjustments(limit: number) {
    return this.listAdjustmentsMock(limit);
  }
}

function baseCommand(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    userName: "Test User",
    idempotencyKey: "key-1",
    productId: "product-1",
    delta: 5,
    sizeAdjustments: [],
    reason: "Recontagem de estoque",
    ...overrides,
  };
}

describe("StockAdjustmentsService.create", () => {
  it("rejects a missing idempotency key", async () => {
    const service = new StockAdjustmentsService(new FakeStockAdjustmentsRepository());
    await expect(service.create(baseCommand({ idempotencyKey: "" }))).rejects.toThrow(HttpError);
  });

  it("rejects a missing productId", async () => {
    const service = new StockAdjustmentsService(new FakeStockAdjustmentsRepository());
    await expect(service.create(baseCommand({ productId: "" }))).rejects.toThrow(HttpError);
  });

  it("rejects a zero delta with no sizeAdjustments", async () => {
    const service = new StockAdjustmentsService(new FakeStockAdjustmentsRepository());
    await expect(service.create(baseCommand({ delta: 0, sizeAdjustments: [] }))).rejects.toThrow(HttpError);
  });

  it("allows a zero top-level delta when sizeAdjustments are present", async () => {
    const repo = new FakeStockAdjustmentsRepository();
    const service = new StockAdjustmentsService(repo);
    const result = await service.create(baseCommand({ delta: 0, sizeAdjustments: [{ size: "M", delta: 3 }] }));
    expect(result.status).toBe(201);
  });

  it("rejects a missing reason", async () => {
    const service = new StockAdjustmentsService(new FakeStockAdjustmentsRepository());
    await expect(service.create(baseCommand({ reason: "" }))).rejects.toThrow(HttpError);
  });

  it("creates an adjustment and marks idempotency completed", async () => {
    const repo = new FakeStockAdjustmentsRepository();
    const service = new StockAdjustmentsService(repo);
    const result = await service.create(baseCommand());
    expect(result.status).toBe(201);
    expect(repo.createAdjustmentMock).toHaveBeenCalledTimes(1);
  });

  it("returns the cached response on a completed retry without re-applying the adjustment", async () => {
    const repo = new FakeStockAdjustmentsRepository();
    const service = new StockAdjustmentsService(repo);
    const command = baseCommand();

    const first = await service.create(command);
    expect(first.status).toBe(201);
    expect(repo.createAdjustmentMock).toHaveBeenCalledTimes(1);

    const second = await service.create(command);
    expect(second.status).toBe(200);
    expect(repo.createAdjustmentMock).toHaveBeenCalledTimes(1);
  });

  it("rejects idempotency key reuse with a different payload", async () => {
    const repo = new FakeStockAdjustmentsRepository();
    const service = new StockAdjustmentsService(repo);
    await service.create(baseCommand({ idempotencyKey: "same-key" }));
    await expect(service.create(baseCommand({ idempotencyKey: "same-key", delta: 99 }))).rejects.toThrow(HttpError);
  });
});

describe("StockAdjustmentsService.list", () => {
  it("delegates to the repository with the given limit", async () => {
    const repo = new FakeStockAdjustmentsRepository();
    const service = new StockAdjustmentsService(repo);
    await service.list(50);
    expect(repo.listAdjustmentsMock).toHaveBeenCalledWith(50);
  });
});
