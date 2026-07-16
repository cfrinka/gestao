import type { SyncResult, UserCommission } from "@/domains/comission/types";

export interface CommissionRepository {
  syncMovements(): Promise<SyncResult>;
  getCommissionReport(targetUserId: string | null): Promise<UserCommission[]>;
}
