import { getCommissionReport, syncCommissionMovements } from "@/domains/comission/comission-db";
import type { CommissionRepository } from "@/domains/comission/repository";
import type { SyncResult, UserCommission } from "@/domains/comission/types";

export class FirestoreCommissionRepository implements CommissionRepository {
  async syncMovements(): Promise<SyncResult> {
    return syncCommissionMovements();
  }

  async getCommissionReport(targetUserId: string | null): Promise<UserCommission[]> {
    return getCommissionReport(targetUserId);
  }
}
