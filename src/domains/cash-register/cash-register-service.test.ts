import { describe, expect, it, vi } from "vitest";
import { CashRegisterService } from "./cash-register-service";
import type { CashRegisterRepository } from "./repository";
import type { CashRegister, Order } from "@/lib/db-types";
import { HttpError } from "@/lib/api/http-errors";

vi.mock("@/domains/users/users-db", () => ({
  getUser: vi.fn(async (userId: string) => ({ id: userId, name: `User ${userId}` })),
}));

function makeRegister(overrides: Partial<CashRegister> = {}): CashRegister {
  return {
    id: "register-1",
    userId: "user-1",
    userName: "Test User",
    openedAt: new Date(),
    closedAt: null,
    openingBalance: 100,
    closingBalance: null,
    status: "OPEN",
    totalSales: 0,
    totalCash: 0,
    totalDebit: 0,
    totalCredit: 0,
    totalPix: 0,
    totalCashSupply: 0,
    totalCashWithdrawal: 0,
    salesCount: 0,
    totalExchangeDifferenceIn: 0,
    exchangeDifferenceCount: 0,
    ...overrides,
  };
}

class FakeCashRegisterRepository implements CashRegisterRepository {
  openRegisterRecord: CashRegister | null = makeRegister();
  idempotencyStore = new Map<string, { requestHash: string; status: "PROCESSING" | "COMPLETED" | "FAILED"; response?: unknown }>();

  getOpenRegisterMock = vi.fn(async (_userId: string) => this.openRegisterRecord);
  openRegisterMock = vi.fn(async (userId: string, userName: string, openingBalance: number): Promise<CashRegister> =>
    makeRegister({ userId, userName, openingBalance })
  );
  closeRegisterMock = vi.fn(async (registerId: string, closingBalance: number): Promise<CashRegister> =>
    makeRegister({ id: registerId, status: "CLOSED", closingBalance })
  );
  getRegisterOrdersMock = vi.fn(async (_registerId: string): Promise<Order[]> => []);
  applyAdjustmentMock = vi.fn(
    async (input: { registerId: string; type: "SUPPLY" | "WITHDRAWAL"; amount: number }): Promise<CashRegister> =>
      makeRegister({ id: input.registerId })
  );

  async getOpenRegister(userId: string) {
    return this.getOpenRegisterMock(userId);
  }
  async openRegister(userId: string, userName: string, openingBalance: number) {
    return this.openRegisterMock(userId, userName, openingBalance);
  }
  async closeRegister(registerId: string, closingBalance: number) {
    return this.closeRegisterMock(registerId, closingBalance);
  }
  async getRegisterOrders(registerId: string) {
    return this.getRegisterOrdersMock(registerId);
  }
  async applyAdjustment(input: Parameters<CashRegisterRepository["applyAdjustment"]>[0]) {
    return this.applyAdjustmentMock(input);
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

describe("CashRegisterService.getOpen", () => {
  it("delegates to the repository", async () => {
    const repo = new FakeCashRegisterRepository();
    const service = new CashRegisterService(repo);
    const result = await service.getOpen("user-1");
    expect(repo.getOpenRegisterMock).toHaveBeenCalledWith("user-1");
    expect(result?.id).toBe("register-1");
  });
});

describe("CashRegisterService.open", () => {
  it("rejects opening when one is already open", async () => {
    const service = new CashRegisterService(new FakeCashRegisterRepository());
    await expect(service.open("user-1", "user@test.com", 100)).rejects.toThrow(HttpError);
  });

  it("opens a register when none is open, using the user's name", async () => {
    const repo = new FakeCashRegisterRepository();
    repo.openRegisterRecord = null;
    const service = new CashRegisterService(repo);
    await service.open("user-1", "user@test.com", 100);
    expect(repo.openRegisterMock).toHaveBeenCalledWith("user-1", "User user-1", 100);
  });
});

describe("CashRegisterService.close", () => {
  it("rejects closing when none is open", async () => {
    const repo = new FakeCashRegisterRepository();
    repo.openRegisterRecord = null;
    const service = new CashRegisterService(repo);
    await expect(service.close("user-1", 50)).rejects.toThrow(HttpError);
  });

  it("closes the open register and returns its orders", async () => {
    const repo = new FakeCashRegisterRepository();
    const service = new CashRegisterService(repo);
    const result = await service.close("user-1", 50);
    expect(repo.closeRegisterMock).toHaveBeenCalledWith("register-1", 50);
    expect(result.register.status).toBe("CLOSED");
  });
});

describe("CashRegisterService.adjust", () => {
  it("rejects when no register is open", async () => {
    const repo = new FakeCashRegisterRepository();
    repo.openRegisterRecord = null;
    const service = new CashRegisterService(repo);
    await expect(
      service.adjust({ userId: "user-1", idempotencyKey: "k1", type: "SUPPLY", amount: 50, actorId: "user-1", actorRole: "CASHIER" })
    ).rejects.toThrow(HttpError);
  });

  it("rejects a missing idempotency key", async () => {
    const service = new CashRegisterService(new FakeCashRegisterRepository());
    await expect(
      service.adjust({ userId: "user-1", idempotencyKey: "", type: "SUPPLY", amount: 50, actorId: "user-1", actorRole: "CASHIER" })
    ).rejects.toThrow(HttpError);
  });

  it("applies a valid adjustment", async () => {
    const repo = new FakeCashRegisterRepository();
    const service = new CashRegisterService(repo);
    const result = await service.adjust({
      userId: "user-1",
      idempotencyKey: "k1",
      type: "WITHDRAWAL",
      amount: 30,
      note: "test",
      actorId: "user-1",
      actorRole: "CASHIER",
    });
    expect(result.status).toBe(201);
    expect(repo.applyAdjustmentMock).toHaveBeenCalledWith({
      registerId: "register-1",
      type: "WITHDRAWAL",
      amount: 30,
      note: "test",
      actorId: "user-1",
      actorRole: "CASHIER",
    });
  });

  it("returns the cached response on a completed retry without re-applying the adjustment", async () => {
    const repo = new FakeCashRegisterRepository();
    const service = new CashRegisterService(repo);
    const command = { userId: "user-1", idempotencyKey: "same-key", type: "SUPPLY" as const, amount: 40, actorId: "user-1", actorRole: "CASHIER" };

    const first = await service.adjust(command);
    expect(first.status).toBe(201);
    expect(repo.applyAdjustmentMock).toHaveBeenCalledTimes(1);

    const second = await service.adjust(command);
    expect(second.status).toBe(200);
    expect(repo.applyAdjustmentMock).toHaveBeenCalledTimes(1);
  });

  it("rejects idempotency key reuse with a different payload", async () => {
    const repo = new FakeCashRegisterRepository();
    const service = new CashRegisterService(repo);
    await service.adjust({ userId: "user-1", idempotencyKey: "conflict-key", type: "SUPPLY", amount: 10, actorId: "user-1", actorRole: "CASHIER" });
    await expect(
      service.adjust({ userId: "user-1", idempotencyKey: "conflict-key", type: "SUPPLY", amount: 999, actorId: "user-1", actorRole: "CASHIER" })
    ).rejects.toThrow(HttpError);
  });

  it("returns 409 when the same idempotency key is already being processed", async () => {
    const repo = new FakeCashRegisterRepository();
    const command = { userId: "user-1", idempotencyKey: "in-progress-key", type: "SUPPLY" as const, amount: 10, actorId: "user-1", actorRole: "CASHIER" };
    const requestHash = JSON.stringify({ registerId: "register-1", type: "SUPPLY", amount: 10, note: null, userId: "user-1" });
    repo.idempotencyStore.set("user-1:in-progress-key", { requestHash, status: "PROCESSING" });

    const service = new CashRegisterService(repo);
    const result = await service.adjust(command);
    expect(result.status).toBe(409);
  });

  it("marks idempotency failed and rethrows when applying the adjustment fails", async () => {
    const repo = new FakeCashRegisterRepository();
    repo.applyAdjustmentMock.mockRejectedValueOnce(new Error("insufficient balance"));
    const service = new CashRegisterService(repo);

    await expect(
      service.adjust({ userId: "user-1", idempotencyKey: "fail-key", type: "WITHDRAWAL", amount: 999, actorId: "user-1", actorRole: "CASHIER" })
    ).rejects.toThrow("insufficient balance");
    expect(repo.idempotencyStore.get("user-1:fail-key")?.status).toBe("FAILED");
  });
});
