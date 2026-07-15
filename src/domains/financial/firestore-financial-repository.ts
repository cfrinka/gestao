import { closeFinancialMonth, runFinancialHealthCheck } from "@/domains/financial/financial-db";
import type { FinancialRepository } from "@/domains/financial/repository";
import type {
  CloseMonthCommand,
  FinancialClosureResult,
  HealthCheckResult,
  RunHealthCheckCommand,
} from "@/domains/financial/types";

export class FirestoreFinancialRepository implements FinancialRepository {
  async closeMonth(input: CloseMonthCommand): Promise<FinancialClosureResult> {
    return closeFinancialMonth(input);
  }

  async runHealthCheck(input: RunHealthCheckCommand): Promise<HealthCheckResult> {
    return runFinancialHealthCheck(input);
  }
}
