import type {
  CloseMonthCommand,
  FinancialClosureResult,
  HealthCheckResult,
  RunHealthCheckCommand,
} from "@/domains/financial/types";

export interface FinancialRepository {
  closeMonth(input: CloseMonthCommand): Promise<FinancialClosureResult>;
  runHealthCheck(input: RunHealthCheckCommand): Promise<HealthCheckResult>;
}
