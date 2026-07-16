import { describe, expect, it, vi } from "vitest";
import { StockAdjustmentsService } from "./stock-adjustments-service";
import { InMemoryStockAdjustmentsRepository } from "./in-memory-stock-adjustments-repository";
import type { AdjustmentResult, StockAdjustmentRecord } from "./types";
import { HttpError } from "@/lib/api/http-errors";

// The service tests below exercise idempotency/error-handling orchestration, not the
// repository's own stock math (that's covered by exercising InMemoryStockAdjustmentsRepository
// directly against a seeded product). So createAdjustment/listAdjustments are spied on with a
// canned default implementation, matching the original FakeStockAdjustmentsRepository test
// double's mocked behavior. vi.spyOn keeps them real vi.fn()s (mockRejectedValueOnce etc. all
// still work) while starting from the production class.
function makeRepo() {
  const repo = new InMemoryStockAdjustmentsRepository(new Map(), new Map(), new Map());
  // Capture the spies and merge them back onto the returned object (rather than just calling
  // vi.spyOn for its side effect) so the static type of `repo.createAdjustment` /
  // `repo.listAdjustments` below is the MockInstance type, exposing mockRejectedValueOnce etc.
  const createAdjustment = vi.spyOn(repo, "createAdjustment").mockImplementation(
    async (): Promise<AdjustmentResult> => ({
      id: "adj-1",
      previousStock: 10,
      nextStock: 15,
      appliedDelta: 5,
    })
  );
  const listAdjustments = vi
    .spyOn(repo, "listAdjustments")
    .mockImplementation(async (): Promise<StockAdjustmentRecord[]> => []);
  return Object.assign(repo, { createAdjustment, listAdjustments });
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
    const service = new StockAdjustmentsService(makeRepo());
    await expect(service.create(baseCommand({ idempotencyKey: "" }))).rejects.toThrow(HttpError);
  });

  it("rejects a missing productId", async () => {
    const service = new StockAdjustmentsService(makeRepo());
    await expect(service.create(baseCommand({ productId: "" }))).rejects.toThrow(HttpError);
  });

  it("rejects a zero delta with no sizeAdjustments", async () => {
    const service = new StockAdjustmentsService(makeRepo());
    await expect(service.create(baseCommand({ delta: 0, sizeAdjustments: [] }))).rejects.toThrow(HttpError);
  });

  it("allows a zero top-level delta when sizeAdjustments are present", async () => {
    const repo = makeRepo();
    const service = new StockAdjustmentsService(repo);
    const result = await service.create(baseCommand({ delta: 0, sizeAdjustments: [{ size: "M", delta: 3 }] }));
    expect(result.status).toBe(201);
  });

  it("rejects a missing reason", async () => {
    const service = new StockAdjustmentsService(makeRepo());
    await expect(service.create(baseCommand({ reason: "" }))).rejects.toThrow(HttpError);
  });

  it("creates an adjustment and marks idempotency completed", async () => {
    const repo = makeRepo();
    const service = new StockAdjustmentsService(repo);
    const result = await service.create(baseCommand());
    expect(result.status).toBe(201);
    expect(repo.createAdjustment).toHaveBeenCalledTimes(1);
  });

  it("returns the cached response on a completed retry without re-applying the adjustment", async () => {
    const repo = makeRepo();
    const service = new StockAdjustmentsService(repo);
    const command = baseCommand();

    const first = await service.create(command);
    expect(first.status).toBe(201);
    expect(repo.createAdjustment).toHaveBeenCalledTimes(1);

    const second = await service.create(command);
    expect(second.status).toBe(200);
    expect(repo.createAdjustment).toHaveBeenCalledTimes(1);
  });

  it("rejects idempotency key reuse with a different payload", async () => {
    const repo = makeRepo();
    const service = new StockAdjustmentsService(repo);
    await service.create(baseCommand({ idempotencyKey: "same-key" }));
    await expect(service.create(baseCommand({ idempotencyKey: "same-key", delta: 99 }))).rejects.toThrow(HttpError);
  });

  it("returns 409 when the same idempotency key is already being processed", async () => {
    const repo = makeRepo();
    const command = baseCommand({ idempotencyKey: "in-progress-key" });
    const requestHash = JSON.stringify({
      productId: command.productId,
      delta: command.delta,
      sizeAdjustments: command.sizeAdjustments,
      reason: command.reason,
      userId: command.userId,
    });
    repo.idempotencyStore.set(`${command.userId}:in-progress-key`, { requestHash, status: "PROCESSING" });

    const service = new StockAdjustmentsService(repo);
    const result = await service.create(command);
    expect(result.status).toBe(409);
  });

  it("marks idempotency failed and rethrows when the repository create fails with an HttpError", async () => {
    const repo = makeRepo();
    repo.createAdjustment.mockRejectedValueOnce(new HttpError(400, "invalid size"));
    const service = new StockAdjustmentsService(repo);
    await expect(service.create(baseCommand({ idempotencyKey: "fail-key-1" }))).rejects.toThrow(HttpError);
    expect(repo.idempotencyStore.get("user-1:fail-key-1")?.status).toBe("FAILED");
  });

  it("marks idempotency failed and rethrows when the repository create fails with a generic Error", async () => {
    const repo = makeRepo();
    repo.createAdjustment.mockRejectedValueOnce(new Error("stock write failed"));
    const service = new StockAdjustmentsService(repo);
    await expect(service.create(baseCommand({ idempotencyKey: "fail-key-2" }))).rejects.toThrow("stock write failed");
    expect(repo.idempotencyStore.get("user-1:fail-key-2")?.status).toBe("FAILED");
  });

  it("marks idempotency failed when the repository create fails with a non-Error value", async () => {
    const repo = makeRepo();
    repo.createAdjustment.mockRejectedValueOnce("not an Error instance");
    const service = new StockAdjustmentsService(repo);
    await expect(service.create(baseCommand({ idempotencyKey: "fail-key-3" }))).rejects.toBe("not an Error instance");
    expect(repo.idempotencyStore.get("user-1:fail-key-3")?.status).toBe("FAILED");
  });
});

describe("StockAdjustmentsService.list", () => {
  it("delegates to the repository with the given limit", async () => {
    const repo = makeRepo();
    const service = new StockAdjustmentsService(repo);
    await service.list(50);
    expect(repo.listAdjustments).toHaveBeenCalledWith(50);
  });
});
