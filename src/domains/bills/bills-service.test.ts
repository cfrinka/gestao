import { describe, expect, it, vi } from "vitest";
import { BillsService } from "./bills-service";
import { InMemoryBillsRepository, type IdempotencyEntry } from "./in-memory-bills-repository";
import type { BillRecord } from "./types";
import { HttpError } from "@/lib/api/http-errors";

function makeRepo() {
  const bills = new Map<string, BillRecord>();
  const idempotency = new Map<string, IdempotencyEntry>();
  const repo = new InMemoryBillsRepository(bills, idempotency);
  return { repo, bills, idempotency };
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
    const { repo, bills } = makeRepo();
    bills.set("b1", { id: "b1", name: "Test", amount: 10, status: "PENDING", kind: "ONE_TIME" });
    const spy = vi.spyOn(repo, "listBills");
    const service = new BillsService(repo);
    const result = await service.list({ month: null, status: "all" });
    expect(result).toHaveLength(1);
    expect(spy).toHaveBeenCalled();
  });
});

describe("BillsService.create", () => {
  it("rejects a missing idempotency key", async () => {
    const { repo } = makeRepo();
    const service = new BillsService(repo);
    await expect(service.create(baseCreateCommand({ idempotencyKey: "" }))).rejects.toThrow(HttpError);
  });

  it("rejects a missing name", async () => {
    const { repo } = makeRepo();
    const service = new BillsService(repo);
    await expect(service.create(baseCreateCommand({ name: "" }))).rejects.toThrow(HttpError);
  });

  it("rejects an invalid amount", async () => {
    const { repo } = makeRepo();
    const service = new BillsService(repo);
    await expect(service.create(baseCreateCommand({ amount: -5 }))).rejects.toThrow(HttpError);
  });

  it("rejects an invalid kind", async () => {
    const { repo } = makeRepo();
    const service = new BillsService(repo);
    await expect(service.create(baseCreateCommand({ kind: "NONSENSE" }))).rejects.toThrow(HttpError);
  });

  it("ONE_TIME requires a dueDate", async () => {
    const { repo } = makeRepo();
    const service = new BillsService(repo);
    await expect(service.create(baseCreateCommand({ dueDate: undefined }))).rejects.toThrow(HttpError);
  });

  it("FIXED validates dayOfMonth range", async () => {
    const { repo } = makeRepo();
    const service = new BillsService(repo);
    await expect(
      service.create(baseCreateCommand({ kind: "FIXED", dayOfMonth: 45, monthsAhead: 12 }))
    ).rejects.toThrow(HttpError);
  });

  it("INSTALLMENTS requires firstDueDate and a valid installmentsCount", async () => {
    const { repo } = makeRepo();
    const service = new BillsService(repo);
    await expect(
      service.create(baseCreateCommand({ kind: "INSTALLMENTS", firstDueDate: undefined, installmentsCount: 3 }))
    ).rejects.toThrow(HttpError);
    await expect(
      service.create(baseCreateCommand({ kind: "INSTALLMENTS", firstDueDate: "2026-08-01", installmentsCount: 0 }))
    ).rejects.toThrow(HttpError);
  });

  it("creates a ONE_TIME bill and marks idempotency completed", async () => {
    const { repo } = makeRepo();
    const spy = vi.spyOn(repo, "createOneTimeBill");
    const service = new BillsService(repo);
    const result = await service.create(baseCreateCommand());
    expect(result.status).toBe(201);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("creates a FIXED bill series", async () => {
    const { repo, bills } = makeRepo();
    const spy = vi.spyOn(repo, "createFixedBills");
    const service = new BillsService(repo);
    const result = await service.create(
      baseCreateCommand({ kind: "FIXED", dayOfMonth: 10, monthsAhead: 6, dueDate: undefined })
    );
    expect(result.status).toBe(201);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Aluguel", amount: 1000, dayOfMonth: 10, monthsAhead: 6 })
    );
    expect(bills.size).toBe(6);
  });

  it("creates an INSTALLMENTS bill series", async () => {
    const { repo, bills } = makeRepo();
    const spy = vi.spyOn(repo, "createInstallments");
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
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Aluguel", amount: 1000, firstDueDate: "2026-08-01", installmentsCount: 3, intervalMonths: 1 })
    );
    expect(bills.size).toBe(3);
  });

  it("returns 409 when the same idempotency key is already being processed", async () => {
    const { repo, idempotency } = makeRepo();
    const command = baseCreateCommand({ idempotencyKey: "in-progress-key" });
    const requestHash = JSON.stringify({ kind: "ONE_TIME", name: command.name, amount: command.amount, dueDate: command.dueDate, userId: command.userId });
    idempotency.set("user-1:in-progress-key", { requestHash, status: "PROCESSING" });

    const service = new BillsService(repo);
    const result = await service.create(command);
    expect(result.status).toBe(409);
  });

  it("marks idempotency failed and rethrows when the repository create fails", async () => {
    const { repo, idempotency } = makeRepo();
    vi.spyOn(repo, "createOneTimeBill").mockRejectedValueOnce(new Error("db write failed"));
    const service = new BillsService(repo);
    await expect(service.create(baseCreateCommand({ idempotencyKey: "fail-key" }))).rejects.toThrow("db write failed");
    expect(idempotency.get("user-1:fail-key")?.status).toBe("FAILED");
  });

  it("returns the cached response on a completed retry without creating a duplicate", async () => {
    const { repo } = makeRepo();
    const spy = vi.spyOn(repo, "createOneTimeBill");
    const service = new BillsService(repo);
    const command = baseCreateCommand();

    const first = await service.create(command);
    expect(first.status).toBe(201);
    expect(spy).toHaveBeenCalledTimes(1);

    const second = await service.create(command);
    expect(second.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rejects idempotency key reuse with a different payload", async () => {
    const { repo } = makeRepo();
    const service = new BillsService(repo);
    await service.create(baseCreateCommand({ idempotencyKey: "same-key" }));
    await expect(service.create(baseCreateCommand({ idempotencyKey: "same-key", amount: 2000 }))).rejects.toThrow(HttpError);
  });
});

describe("BillsService.markPaid / markUnpaid / remove", () => {
  it("markPaid rejects a non-admin actor", async () => {
    const { repo } = makeRepo();
    const service = new BillsService(repo);
    await expect(
      service.markPaid({ billId: "b1", method: "DINHEIRO", actorId: "u1", actorRole: "CASHIER" })
    ).rejects.toThrow(HttpError);
  });

  it("markPaid rejects a nonexistent bill", async () => {
    const { repo } = makeRepo();
    const service = new BillsService(repo);
    await expect(
      service.markPaid({ billId: "missing", method: "DINHEIRO", actorId: "admin-1", actorRole: "ADMIN" })
    ).rejects.toThrow(HttpError);
  });

  it("markPaid succeeds for an admin on an existing bill", async () => {
    const { repo, bills } = makeRepo();
    bills.set("b1", { id: "b1", name: "Test", amount: 100, status: "PENDING", kind: "ONE_TIME" });
    const service = new BillsService(repo);
    const spy = vi.spyOn(repo, "markBillPaid");
    const updated = await service.markPaid({ billId: "b1", method: "PIX", actorId: "admin-1", actorRole: "ADMIN" });
    expect(updated.status).toBe("PAID");
    expect(spy).toHaveBeenCalledWith({ billId: "b1", method: "PIX", actorId: "admin-1" });
  });

  it("markUnpaid rejects a non-admin actor", async () => {
    const { repo } = makeRepo();
    const service = new BillsService(repo);
    await expect(service.markUnpaid({ billId: "b1", actorId: "u1", actorRole: "CASHIER" })).rejects.toThrow(HttpError);
  });

  it("markUnpaid rejects a nonexistent bill", async () => {
    const { repo } = makeRepo();
    const service = new BillsService(repo);
    await expect(service.markUnpaid({ billId: "missing", actorId: "admin-1", actorRole: "ADMIN" })).rejects.toThrow(HttpError);
  });

  it("markUnpaid succeeds for an admin on an existing bill", async () => {
    const { repo, bills } = makeRepo();
    bills.set("b1", { id: "b1", name: "Test", amount: 100, status: "PAID", kind: "ONE_TIME" });
    const service = new BillsService(repo);
    const spy = vi.spyOn(repo, "markBillUnpaid");
    const updated = await service.markUnpaid({ billId: "b1", actorId: "admin-1", actorRole: "ADMIN" });
    expect(updated.status).toBe("PENDING");
    expect(spy).toHaveBeenCalledWith({ billId: "b1", actorId: "admin-1" });
  });

  it("remove rejects a non-admin actor", async () => {
    const { repo } = makeRepo();
    const service = new BillsService(repo);
    await expect(service.remove({ billId: "b1", actorId: "u1", actorRole: "CASHIER" })).rejects.toThrow(HttpError);
  });

  it("remove rejects a nonexistent bill", async () => {
    const { repo } = makeRepo();
    const service = new BillsService(repo);
    await expect(service.remove({ billId: "missing", actorId: "admin-1", actorRole: "ADMIN" })).rejects.toThrow(HttpError);
  });

  it("remove succeeds for an admin on an existing bill", async () => {
    const { repo, bills } = makeRepo();
    bills.set("b1", { id: "b1", name: "Test", amount: 100, status: "PENDING", kind: "ONE_TIME" });
    const service = new BillsService(repo);
    const spy = vi.spyOn(repo, "deleteBill");
    await service.remove({ billId: "b1", actorId: "admin-1", actorRole: "ADMIN" });
    expect(spy).toHaveBeenCalledWith({ billId: "b1", actorId: "admin-1" });
    expect(bills.has("b1")).toBe(false);
  });
});
