import { describe, expect, it, vi } from "vitest";
import { CommissionService } from "./comission-service";
import type { CommissionRepository } from "./repository";
import type { SyncResult, UserCommission } from "./types";
import { HttpError } from "@/lib/api/http-errors";

class FakeCommissionRepository implements CommissionRepository {
  syncMovementsMock = vi.fn(async (): Promise<SyncResult> => ({ synced: 2, fixed: 1, message: "2 venda(s) sincronizada(s). 1 registro(s) corrigido(s)." }));
  getCommissionReportMock = vi.fn(async (_targetUserId: string | null): Promise<UserCommission[]> => []);

  async syncMovements() {
    return this.syncMovementsMock();
  }
  async getCommissionReport(targetUserId: string | null) {
    return this.getCommissionReportMock(targetUserId);
  }
}

describe("CommissionService.sync", () => {
  it("rejects a non-admin actor", async () => {
    const service = new CommissionService(new FakeCommissionRepository());
    await expect(service.sync("CASHIER")).rejects.toThrow(HttpError);
  });

  it("allows an admin and returns the sync result", async () => {
    const repo = new FakeCommissionRepository();
    const service = new CommissionService(repo);
    const result = await service.sync("ADMIN");
    expect(repo.syncMovementsMock).toHaveBeenCalledTimes(1);
    expect(result.synced).toBe(2);
  });
});

describe("CommissionService.getReport", () => {
  it("rejects a role that isn't ADMIN or CASHIER", async () => {
    const service = new CommissionService(new FakeCommissionRepository());
    await expect(service.getReport("u1", "GUEST")).rejects.toThrow(HttpError);
  });

  it("an admin sees everyone (targetUserId is null)", async () => {
    const repo = new FakeCommissionRepository();
    const service = new CommissionService(repo);
    const report = await service.getReport("admin-1", "ADMIN");
    expect(repo.getCommissionReportMock).toHaveBeenCalledWith(null);
    expect(report.isAdmin).toBe(true);
    expect(report.currentUserId).toBe("admin-1");
  });

  it("a cashier only sees their own report (targetUserId is their own uid)", async () => {
    const repo = new FakeCommissionRepository();
    const service = new CommissionService(repo);
    const report = await service.getReport("cashier-1", "CASHIER");
    expect(repo.getCommissionReportMock).toHaveBeenCalledWith("cashier-1");
    expect(report.isAdmin).toBe(false);
  });
});
