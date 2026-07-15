import { describe, expect, it, vi } from "vitest";
import { FinancialService } from "./financial-service";
import { FinancialMonthAlreadyClosedError } from "./financial-db";
import type { FinancialRepository } from "./repository";
import type { CloseMonthCommand, FinancialClosureResult, HealthCheckResult, RunHealthCheckCommand } from "./types";
import { HttpError } from "@/lib/api/http-errors";

class FakeFinancialRepository implements FinancialRepository {
  closeMonthMock = vi.fn(
    async (input: CloseMonthCommand): Promise<FinancialClosureResult> => ({
      id: input.month,
      month: input.month,
      revenue: 100,
      cogs: 50,
      grossProfit: 50,
      expenses: 10,
      netResult: 40,
      cashIn: 100,
      cashOut: 10,
      inventoryValue: 500,
      fiadoOutstanding: 20,
      lockedBy: input.actorId,
    })
  );
  runHealthCheckMock = vi.fn(
    async (_input: RunHealthCheckCommand): Promise<HealthCheckResult> => ({
      runId: "run-1",
      aggregatedMonths: 13,
      closurePreviewMonth: "2026-06",
      closurePreviewCreated: true,
      anomalyCount: 0,
      anomalies: [],
    })
  );

  async closeMonth(input: CloseMonthCommand) {
    return this.closeMonthMock(input);
  }
  async runHealthCheck(input: RunHealthCheckCommand) {
    return this.runHealthCheckMock(input);
  }
}

function toCompetencyMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

const CURRENT_MONTH = toCompetencyMonth(new Date());
// A month far enough in the past to never collide with "current month" or the fake-closure test data.
const PAST_MONTH = toCompetencyMonth(new Date(new Date().getFullYear() - 1, 0, 1));

describe("FinancialService.closeMonth", () => {
  it("rejects a non-admin actor", async () => {
    const service = new FinancialService(new FakeFinancialRepository());
    await expect(
      service.closeMonth({ month: PAST_MONTH, actorId: "u1", actorRole: "CASHIER" })
    ).rejects.toThrow(HttpError);
  });

  it("rejects an invalid month format", async () => {
    const service = new FinancialService(new FakeFinancialRepository());
    await expect(
      service.closeMonth({ month: "not-a-month", actorId: "u1", actorRole: "ADMIN" })
    ).rejects.toThrow(HttpError);
  });

  it("rejects closing the current month", async () => {
    const service = new FinancialService(new FakeFinancialRepository());
    await expect(
      service.closeMonth({ month: CURRENT_MONTH, actorId: "u1", actorRole: "ADMIN" })
    ).rejects.toThrow(HttpError);
  });

  it("translates FinancialMonthAlreadyClosedError into a 409 HttpError", async () => {
    const repo = new FakeFinancialRepository();
    repo.closeMonthMock.mockRejectedValueOnce(new FinancialMonthAlreadyClosedError(PAST_MONTH));
    const service = new FinancialService(repo);

    await expect(
      service.closeMonth({ month: PAST_MONTH, actorId: "u1", actorRole: "ADMIN" })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("closes a valid past month and returns the repository's result", async () => {
    const repo = new FakeFinancialRepository();
    const service = new FinancialService(repo);

    const result = await service.closeMonth({ month: PAST_MONTH, actorId: "admin-1", actorRole: "ADMIN" });

    expect(repo.closeMonthMock).toHaveBeenCalledWith({ month: PAST_MONTH, actorId: "admin-1", actorRole: "ADMIN" });
    expect(result.month).toBe(PAST_MONTH);
    expect(result.netResult).toBe(40);
  });
});

describe("FinancialService.runHealthCheck", () => {
  it("rejects a role that isn't ADMIN or SYSTEM", async () => {
    const service = new FinancialService(new FakeFinancialRepository());
    await expect(service.runHealthCheck({ actorId: "u1", actorRole: "CASHIER" })).rejects.toThrow(HttpError);
  });

  it("allows ADMIN", async () => {
    const repo = new FakeFinancialRepository();
    const service = new FinancialService(repo);
    const result = await service.runHealthCheck({ actorId: "admin-1", actorRole: "ADMIN" });
    expect(repo.runHealthCheckMock).toHaveBeenCalledWith({ actorId: "admin-1", actorRole: "ADMIN" });
    expect(result.runId).toBe("run-1");
  });

  it("allows SYSTEM (automation)", async () => {
    const repo = new FakeFinancialRepository();
    const service = new FinancialService(repo);
    await service.runHealthCheck({ actorId: "automation", actorRole: "SYSTEM" });
    expect(repo.runHealthCheckMock).toHaveBeenCalledWith({ actorId: "automation", actorRole: "SYSTEM" });
  });
});
