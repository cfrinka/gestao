import { describe, expect, it, vi } from "vitest";
import { BillsService } from "./bills-service";
import type { BillsRepository } from "./repository";
import type { BillRecord, IdempotencyReservation } from "./types";
import { HttpError } from "@/lib/api/http-errors";

class FakeBillsRepository implements BillsRepository {
  idempotencyStore = new Map<string, { requestHash: string; status: "PROCESSING" | "COMPLETED" | "FAILED"; response?: unknown }>();

  createFixedBillsMock = vi.fn(async (_params: Parameters<BillsRepository["createFixedBills"]>[0]) => ({
    groupId: "group-1",
    createdIds: ["id-1", "id-2"],
  }));
  createOneTimeBillMock = vi.fn(async (_params: Parameters<BillsRepository["createOneTimeBill"]>[0]) => ({ id: "bill-1" }));
  createInstallmentsMock = vi.fn(async (_params: Parameters<BillsRepository["createInstallments"]>[0]) => ({
    groupId: "group-2",
    createdIds: ["i-1", "i-2", "i-3"],
  }));
  listBillsMock = vi.fn(async (): Promise<BillRecord[]> => []);
  getBillMock = vi.fn(async (_billId: string) => ({ exists: true }));
  markBillPaidMock = vi.fn(async (input: { billId: string; method: string; actorId: string }): Promise<BillRecord> => ({
    id: input.billId,
    name: "Test",
    amount: 100,
    status: "PAID",
    kind: "ONE_TIME",
  }));
  markBillUnpaidMock = vi.fn(async (input: { billId: string; actorId: string }): Promise<BillRecord> => ({
    id: input.billId,
    name: "Test",
    amount: 100,
    status: "PENDING",
    kind: "ONE_TIME",
  }));
  deleteBillMock = vi.fn(async (_input: { billId: string; actorId: string }) => {});

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

  async createFixedBills(params: Parameters<BillsRepository["createFixedBills"]>[0]) {
    return this.createFixedBillsMock(params);
  }
  async createOneTimeBill(params: Parameters<BillsRepository["createOneTimeBill"]>[0]) {
    return this.createOneTimeBillMock(params);
  }
  async createInstallments(params: Parameters<BillsRepository["createInstallments"]>[0]) {
    return this.createInstallmentsMock(params);
  }
  async listBills() {
    return this.listBillsMock();
  }
  async getBill(billId: string) {
    return this.getBillMock(billId);
  }
  async markBillPaid(input: { billId: string; method: string; actorId: string }) {
    return this.markBillPaidMock(input);
  }
  async markBillUnpaid(input: { billId: string; actorId: string }) {
    return this.markBillUnpaidMock(input);
  }
  async deleteBill(input: { billId: string; actorId: string }) {
    return this.deleteBillMock(input);
  }
}

function baseCreateCommand(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    idempotencyKey: "key-1",
    kind: "ONE_TIME",
    name: "Aluguel",
    amount: 1000,
    dueDate: "2026-08-01",
    ...overrides,
  };
}

describe("BillsService.list", () => {
  it("delegates to the repository", async () => {
    const repo = new FakeBillsRepository();
    const service = new BillsService(repo);
    await service.list({ month: null, status: "all" });
    expect(repo.listBillsMock).toHaveBeenCalled();
  });
});

describe("BillsService.create", () => {
  it("rejects a missing idempotency key", async () => {
    const service = new BillsService(new FakeBillsRepository());
    await expect(service.create(baseCreateCommand({ idempotencyKey: "" }))).rejects.toThrow(HttpError);
  });

  it("rejects a missing name", async () => {
    const service = new BillsService(new FakeBillsRepository());
    await expect(service.create(baseCreateCommand({ name: "" }))).rejects.toThrow(HttpError);
  });

  it("rejects an invalid amount", async () => {
    const service = new BillsService(new FakeBillsRepository());
    await expect(service.create(baseCreateCommand({ amount: -5 }))).rejects.toThrow(HttpError);
  });

  it("rejects an invalid kind", async () => {
    const service = new BillsService(new FakeBillsRepository());
    await expect(service.create(baseCreateCommand({ kind: "NONSENSE" }))).rejects.toThrow(HttpError);
  });

  it("ONE_TIME requires a dueDate", async () => {
    const service = new BillsService(new FakeBillsRepository());
    await expect(service.create(baseCreateCommand({ dueDate: undefined }))).rejects.toThrow(HttpError);
  });

  it("FIXED validates dayOfMonth range", async () => {
    const service = new BillsService(new FakeBillsRepository());
    await expect(
      service.create(baseCreateCommand({ kind: "FIXED", dayOfMonth: 45, monthsAhead: 12 }))
    ).rejects.toThrow(HttpError);
  });

  it("INSTALLMENTS requires firstDueDate and a valid installmentsCount", async () => {
    const service = new BillsService(new FakeBillsRepository());
    await expect(
      service.create(baseCreateCommand({ kind: "INSTALLMENTS", firstDueDate: undefined, installmentsCount: 3 }))
    ).rejects.toThrow(HttpError);
    await expect(
      service.create(baseCreateCommand({ kind: "INSTALLMENTS", firstDueDate: "2026-08-01", installmentsCount: 0 }))
    ).rejects.toThrow(HttpError);
  });

  it("creates a ONE_TIME bill and marks idempotency completed", async () => {
    const repo = new FakeBillsRepository();
    const service = new BillsService(repo);
    const result = await service.create(baseCreateCommand());
    expect(result.status).toBe(201);
    expect(repo.createOneTimeBillMock).toHaveBeenCalledTimes(1);
  });

  it("creates a FIXED bill series", async () => {
    const repo = new FakeBillsRepository();
    const service = new BillsService(repo);
    const result = await service.create(
      baseCreateCommand({ kind: "FIXED", dayOfMonth: 10, monthsAhead: 6, dueDate: undefined })
    );
    expect(result.status).toBe(201);
    expect(repo.createFixedBillsMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Aluguel", amount: 1000, dayOfMonth: 10, monthsAhead: 6 })
    );
  });

  it("creates an INSTALLMENTS bill series", async () => {
    const repo = new FakeBillsRepository();
    const service = new BillsService(repo);
    const result = await service.create(
      baseCreateCommand({
        kind: "INSTALLMENTS",
        dueDate: undefined,
        firstDueDate: "2026-08-01",
        installmentsCount: 3,
        intervalMonths: 1,
      })
    );
    expect(result.status).toBe(201);
    expect(repo.createInstallmentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Aluguel", amount: 1000, firstDueDate: "2026-08-01", installmentsCount: 3, intervalMonths: 1 })
    );
  });

  it("returns 409 when the same idempotency key is already being processed", async () => {
    const repo = new FakeBillsRepository();
    const command = baseCreateCommand({ idempotencyKey: "in-progress-key" });
    const requestHash = JSON.stringify({ kind: "ONE_TIME", name: command.name, amount: command.amount, dueDate: command.dueDate, userId: command.userId });
    repo.idempotencyStore.set("user-1:in-progress-key", { requestHash, status: "PROCESSING" });

    const service = new BillsService(repo);
    const result = await service.create(command);
    expect(result.status).toBe(409);
  });

  it("marks idempotency failed and rethrows when the repository create fails", async () => {
    const repo = new FakeBillsRepository();
    repo.createOneTimeBillMock.mockRejectedValueOnce(new Error("db write failed"));
    const service = new BillsService(repo);
    await expect(service.create(baseCreateCommand({ idempotencyKey: "fail-key" }))).rejects.toThrow("db write failed");
    expect(repo.idempotencyStore.get("user-1:fail-key")?.status).toBe("FAILED");
  });

  it("returns the cached response on a completed retry without creating a duplicate", async () => {
    const repo = new FakeBillsRepository();
    const service = new BillsService(repo);
    const command = baseCreateCommand();

    const first = await service.create(command);
    expect(first.status).toBe(201);
    expect(repo.createOneTimeBillMock).toHaveBeenCalledTimes(1);

    const second = await service.create(command);
    expect(second.status).toBe(200);
    expect(repo.createOneTimeBillMock).toHaveBeenCalledTimes(1);
  });

  it("rejects idempotency key reuse with a different payload", async () => {
    const repo = new FakeBillsRepository();
    const service = new BillsService(repo);
    await service.create(baseCreateCommand({ idempotencyKey: "same-key" }));
    await expect(service.create(baseCreateCommand({ idempotencyKey: "same-key", amount: 2000 }))).rejects.toThrow(HttpError);
  });
});

describe("BillsService.markPaid / markUnpaid / remove", () => {
  it("markPaid rejects a non-admin actor", async () => {
    const service = new BillsService(new FakeBillsRepository());
    await expect(
      service.markPaid({ billId: "b1", method: "DINHEIRO", actorId: "u1", actorRole: "CASHIER" })
    ).rejects.toThrow(HttpError);
  });

  it("markPaid rejects a nonexistent bill", async () => {
    const repo = new FakeBillsRepository();
    repo.getBillMock.mockResolvedValueOnce({ exists: false });
    const service = new BillsService(repo);
    await expect(
      service.markPaid({ billId: "missing", method: "DINHEIRO", actorId: "admin-1", actorRole: "ADMIN" })
    ).rejects.toThrow(HttpError);
  });

  it("markPaid succeeds for an admin on an existing bill", async () => {
    const repo = new FakeBillsRepository();
    const service = new BillsService(repo);
    const updated = await service.markPaid({ billId: "b1", method: "PIX", actorId: "admin-1", actorRole: "ADMIN" });
    expect(updated.status).toBe("PAID");
    expect(repo.markBillPaidMock).toHaveBeenCalledWith({ billId: "b1", method: "PIX", actorId: "admin-1" });
  });

  it("markUnpaid rejects a non-admin actor", async () => {
    const service = new BillsService(new FakeBillsRepository());
    await expect(service.markUnpaid({ billId: "b1", actorId: "u1", actorRole: "CASHIER" })).rejects.toThrow(HttpError);
  });

  it("markUnpaid rejects a nonexistent bill", async () => {
    const repo = new FakeBillsRepository();
    repo.getBillMock.mockResolvedValueOnce({ exists: false });
    const service = new BillsService(repo);
    await expect(service.markUnpaid({ billId: "missing", actorId: "admin-1", actorRole: "ADMIN" })).rejects.toThrow(HttpError);
  });

  it("markUnpaid succeeds for an admin on an existing bill", async () => {
    const repo = new FakeBillsRepository();
    const service = new BillsService(repo);
    const updated = await service.markUnpaid({ billId: "b1", actorId: "admin-1", actorRole: "ADMIN" });
    expect(updated.status).toBe("PENDING");
    expect(repo.markBillUnpaidMock).toHaveBeenCalledWith({ billId: "b1", actorId: "admin-1" });
  });

  it("remove rejects a non-admin actor", async () => {
    const service = new BillsService(new FakeBillsRepository());
    await expect(service.remove({ billId: "b1", actorId: "u1", actorRole: "CASHIER" })).rejects.toThrow(HttpError);
  });

  it("remove rejects a nonexistent bill", async () => {
    const repo = new FakeBillsRepository();
    repo.getBillMock.mockResolvedValueOnce({ exists: false });
    const service = new BillsService(repo);
    await expect(service.remove({ billId: "missing", actorId: "admin-1", actorRole: "ADMIN" })).rejects.toThrow(HttpError);
  });

  it("remove succeeds for an admin on an existing bill", async () => {
    const repo = new FakeBillsRepository();
    const service = new BillsService(repo);
    await service.remove({ billId: "b1", actorId: "admin-1", actorRole: "ADMIN" });
    expect(repo.deleteBillMock).toHaveBeenCalledWith({ billId: "b1", actorId: "admin-1" });
  });
});
