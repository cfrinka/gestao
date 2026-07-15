export interface MovementDoc {
  type?: string;
  direction?: "IN" | "OUT";
  amount?: number;
  competencyMonth?: string;
  relatedEntity?: { kind?: string; id?: string };
}

export interface CloseMonthCommand {
  month: string;
  actorId: string;
  actorRole: string;
}

export interface FinancialClosureResult {
  id: string;
  month: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netResult: number;
  cashIn: number;
  cashOut: number;
  inventoryValue: number;
  fiadoOutstanding: number;
  lockedBy: string;
}

export interface RunHealthCheckCommand {
  actorId: string;
  actorRole: string;
}

export interface MonthAggregation {
  month: string;
  movementCount: number;
  revenue: number;
  cogs: number;
  expenses: number;
  stockPurchases: number;
  fiadoPayments: number;
  exchangeDifference: number;
  cashIn: number;
  cashOut: number;
  netResult: number;
}

export interface AnomalyRow {
  month: string;
  issues: string[];
  severity: "info" | "warning" | "high";
}

export interface HealthCheckResult {
  runId: string;
  aggregatedMonths: number;
  closurePreviewMonth: string;
  closurePreviewCreated: boolean;
  anomalyCount: number;
  anomalies: AnomalyRow[];
}
