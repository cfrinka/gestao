import { HttpError } from "@/lib/api/http-errors";
import type { CommissionRepository } from "@/domains/comission/repository";
import type { CommissionReport, SyncResult } from "@/domains/comission/types";

export class CommissionService {
  constructor(private readonly repository: CommissionRepository) {}

  async sync(actorRole: string): Promise<SyncResult> {
    if (actorRole !== "ADMIN") {
      throw new HttpError(403, "Only admins can sync commission data");
    }
    return this.repository.syncMovements();
  }

  async getReport(actorId: string, actorRole: string): Promise<CommissionReport> {
    if (actorRole !== "ADMIN" && actorRole !== "CASHIER") {
      throw new HttpError(403, "Forbidden");
    }

    const isAdmin = actorRole === "ADMIN";
    const targetUserId = isAdmin ? null : actorId;
    const data = await this.repository.getCommissionReport(targetUserId);

    return { isAdmin, currentUserId: actorId, data };
  }
}
