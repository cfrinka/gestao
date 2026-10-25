import { HttpError } from "@/lib/api/http-errors";
import { FinancialMonthAlreadyClosedError } from "@/domains/financial/financial-db";
import type { FinancialRepository } from "@/domains/financial/repository";
import type { FinancialClosureResult, HealthCheckResult } from "@/domains/financial/types";
import { toCompetencyMonth } from "@/lib/dates";

function isValidCompetencyMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export class FinancialService {
  constructor(private readonly repository: FinancialRepository) {}

  async closeMonth(command: { month: string; actorId: string; actorRole: string }): Promise<FinancialClosureResult> {
    if (command.actorRole !== "ADMIN") {
      throw new HttpError(403, "Só administradores podem fechar o mês");
    }

    const month = (command.month || "").trim();
    if (!isValidCompetencyMonth(month)) {
      throw new HttpError(400, "Mês inválido");
    }

    const currentMonth = toCompetencyMonth(new Date());
    if (month === currentMonth) {
      throw new HttpError(400, "O mês atual ainda não pode ser fechado");
    }

    try {
      return await this.repository.closeMonth({ month, actorId: command.actorId, actorRole: command.actorRole });
    } catch (error) {
      if (error instanceof FinancialMonthAlreadyClosedError) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
  }

  async runHealthCheck(command: { actorId: string; actorRole: string }): Promise<HealthCheckResult> {
    if (command.actorRole !== "ADMIN" && command.actorRole !== "SYSTEM") {
      throw new HttpError(403, "Sem permissão");
    }

    return this.repository.runHealthCheck(command);
  }
}
