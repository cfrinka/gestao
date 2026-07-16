import { randomUUID } from "crypto";
import type { CashRegister, Client, Order, Product } from "@/lib/db-types";
import type { BillRecord } from "@/domains/bills/types";
import { FinancialMonthAlreadyClosedError } from "@/domains/financial/financial-db";
import type { FinancialRepository } from "@/domains/financial/repository";
import type {
  CloseMonthCommand,
  FinancialClosureResult,
  HealthCheckResult,
  RunHealthCheckCommand,
} from "@/domains/financial/types";

function toCompetencyMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Bill date fields (`paidAt`, `dueDate`, ...) are typed `unknown` in @/domains/bills/types
 * because the real implementation stores Firestore Timestamps there. Coerces a Date, an ISO
 * string/number, or a Timestamp-shaped `{ toDate(): Date }` object into a real Date, or null.
 */
function coerceDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

/**
 * Demo-mode financial repository. The real closeFinancialMonth() (financial-db.ts) aggregates
 * a `financialMovements` ledger inside a Firestore transaction; demo mode has no such ledger,
 * so this repository derives a simplified closure directly from the shared `orders`, `bills`,
 * `products`, `clients`, and `cashRegisters` Maps. Repositories are constructed fresh per
 * request but must observe the same session data, so all of that state — including which
 * months have already been closed — is taken as constructor parameters rather than owned by
 * this instance.
 *
 * Simplifications vs. the real implementation (acceptable for a low-visibility admin demo
 * screen — see task scope note):
 *  - No `financialMovements` ledger: revenue/cogs come straight from `orders`, expenses from
 *    paid `bills`, instead of SALE_REVENUE/COGS/OPERATING_EXPENSE movement rows.
 *  - `cashIn`/`cashOut` are derived from cash registers *opened* in the target month
 *    (payment-method totals + manual supply as IN, manual withdrawal as OUT), not a full
 *    ledger reconciliation — exchanges/refunds aren't folded in separately.
 *  - `fiadoOutstanding` sums each client's current `balance` (a live snapshot), not each
 *    order's `remainingAmount` as of the closed month — the real implementation is
 *    month-scoped, this is "outstanding right now".
 *  - `stockPurchases` isn't read at all: the real closure doesn't feed STOCK_PURCHASE
 *    movements into `expenses` either (only OPERATING_EXPENSE does), so there was nothing to
 *    wire up for this simplified formula.
 */
export class InMemoryFinancialRepository implements FinancialRepository {
  constructor(
    private orders: Map<string, Order>,
    private bills: Map<string, BillRecord>,
    private products: Map<string, Product>,
    private clients: Map<string, Client>,
    private cashRegisters: Map<string, CashRegister>,
    private closedMonths: Set<string>
  ) {}

  async closeMonth(input: CloseMonthCommand): Promise<FinancialClosureResult> {
    const { month, actorId } = input;

    if (this.closedMonths.has(month)) {
      throw new FinancialMonthAlreadyClosedError(month);
    }

    // NOTE: uses Map#forEach (a callback, not `for...of`/spread/Array.from(iterator)) throughout
    // this class because this project's tsconfig has no explicit `target`/`downlevelIteration`,
    // under which any of those over a Map's iterators fails to type-check (TS2802).
    let revenue = 0;
    let cogs = 0;
    this.orders.forEach((order) => {
      if (order.isCancelled) return;
      if (toCompetencyMonth(new Date(order.createdAt)) !== month) return;
      revenue += Number(order.totalAmount || 0);
      cogs += Number(order.cogsTotal || 0);
    });

    let expenses = 0;
    this.bills.forEach((bill) => {
      if (String(bill.status || "").toUpperCase() !== "PAID") return;
      const paidAt = coerceDate(bill.paidAt);
      if (!paidAt || toCompetencyMonth(paidAt) !== month) return;
      expenses += Number(bill.amount || 0);
    });

    let cashIn = 0;
    let cashOut = 0;
    this.cashRegisters.forEach((register) => {
      if (toCompetencyMonth(new Date(register.openedAt)) !== month) return;
      cashIn +=
        Number(register.totalCash || 0) +
        Number(register.totalDebit || 0) +
        Number(register.totalCredit || 0) +
        Number(register.totalPix || 0) +
        Number(register.totalCashSupply || 0);
      cashOut += Number(register.totalCashWithdrawal || 0);
    });

    const grossProfit = revenue - cogs;
    const netResult = grossProfit - expenses;

    let inventoryValue = 0;
    this.products.forEach((product) => {
      inventoryValue += Number(product.stock || 0) * Number(product.costPrice || 0);
    });

    let fiadoOutstanding = 0;
    this.clients.forEach((client) => {
      fiadoOutstanding += Math.max(0, Number(client.balance || 0));
    });

    this.closedMonths.add(month);

    return {
      id: month,
      month,
      revenue,
      cogs,
      grossProfit,
      expenses,
      netResult,
      cashIn,
      cashOut,
      inventoryValue,
      fiadoOutstanding,
      lockedBy: actorId,
    };
  }

  async runHealthCheck(_input: RunHealthCheckCommand): Promise<HealthCheckResult> {
    // Diagnostic/admin-only automation job. The real implementation recomputes and persists
    // 13 months of aggregates plus a closure preview for the previous month; there's no real
    // invariant to violate against a demo dataset, so this returns a plausible static-ish
    // response instead of reimplementing the full rolling reconciliation.
    const distinctMonths = new Set<string>();
    this.orders.forEach((order) => {
      distinctMonths.add(toCompetencyMonth(new Date(order.createdAt)));
    });

    return {
      runId: randomUUID(),
      aggregatedMonths: distinctMonths.size,
      closurePreviewMonth: toCompetencyMonth(new Date()),
      closurePreviewCreated: false,
      anomalyCount: 0,
      anomalies: [],
    };
  }
}
