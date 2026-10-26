import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { FinancialAuditAction } from "@/lib/db-types";
import type {
  AnomalyRow,
  CloseMonthCommand,
  FinancialClosureResult,
  HealthCheckResult,
  MonthAggregation,
  MovementDoc,
  RunHealthCheckCommand,
} from "@/domains/financial/types";
import { closedMonthError } from "@/lib/api/http-errors";
import { cashEffect } from "@/domains/financial/cash-effect";
import { addMonthsISO, currentMonthISO, storeMonthRange, toCompetencyMonth } from "@/lib/dates";

export { toCompetencyMonth };

function getMonthDateRange(month: string): { start: Date; end: Date } {
  const range = storeMonthRange(month);
  if (!range) throw new Error(`Invalid competency month ${month}`);
  return range;
}

function previousMonth(month: string): string {
  return addMonthsISO(month, -1);
}

function listRecentMonths(lastN: number): string[] {
  const current = currentMonthISO();
  return Array.from({ length: lastN }, (_, i) => addMonthsISO(current, -i));
}

export class FinancialMonthAlreadyClosedError extends Error {
  constructor(month: string) {
    super(`Month ${month} is already closed`);
    this.name = "FinancialMonthAlreadyClosedError";
  }
}

export async function isFinancialMonthClosed(month: string): Promise<boolean> {
  const closure = await adminDb.collection("financialClosures").doc(month).get();
  return closure.exists;
}

export async function assertFinancialMonthOpen(date: Date): Promise<void> {
  const month = toCompetencyMonth(date);
  const closed = await isFinancialMonthClosed(month);
  if (closed) {
    throw closedMonthError(month);
  }
}

/** Transaction-safe variant of assertFinancialMonthOpen, for callers already inside a runTransaction. */
export async function assertFinancialMonthOpenTx(tx: FirebaseFirestore.Transaction, date: Date): Promise<void> {
  const month = toCompetencyMonth(date);
  const closureSnap = await tx.get(adminDb.collection("financialClosures").doc(month));
  if (closureSnap.exists) {
    throw closedMonthError(month);
  }
}

export async function createFinancialAuditLog(
  input: {
    action: FinancialAuditAction;
    actorId: string;
    actorRole: string;
    occurredAt?: Date;
    competencyMonth?: string;
    relatedEntity?: { kind: string; id: string };
    payload?: Record<string, unknown>;
  },
  tx?: FirebaseFirestore.Transaction
): Promise<void> {
  const occurredDate =
    input.occurredAt instanceof Date && !Number.isNaN(input.occurredAt.getTime()) ? input.occurredAt : new Date();

  const payload = {
    action: input.action,
    actorId: input.actorId,
    actorRole: input.actorRole,
    occurredAt: Timestamp.fromDate(occurredDate),
    ...(input.competencyMonth ? { competencyMonth: input.competencyMonth } : {}),
    ...(input.relatedEntity ? { relatedEntity: input.relatedEntity } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
  };

  const ref = adminDb.collection("financialAuditLogs").doc();
  if (tx) {
    tx.set(ref, payload);
    return;
  }
  await ref.set(payload);
}

/**
 * Closes a competency month atomically: the closure-existence check, the aggregation reads,
 * the closure write, and the audit log write all happen inside one transaction. A concurrent
 * close attempt for the same month is rejected (not silently raced), and a crash mid-way can
 * no longer leave a closure with no audit trail.
 */
export async function closeFinancialMonth(input: CloseMonthCommand): Promise<FinancialClosureResult> {
  const { month, actorId, actorRole } = input;
  const closureRef = adminDb.collection("financialClosures").doc(month);
  const { end } = getMonthDateRange(month);

  return adminDb.runTransaction(async (tx) => {
    // ALL READS FIRST
    const closureSnap = await tx.get(closureRef);
    if (closureSnap.exists) {
      throw new FinancialMonthAlreadyClosedError(month);
    }

    const movementsSnap = await tx.get(
      adminDb.collection("financialMovements").where("competencyMonth", "==", month)
    );
    const productsSnap = await tx.get(adminDb.collection("products"));
    const ordersSnap = await tx.get(
      adminDb.collection("orders").where("createdAt", "<=", Timestamp.fromDate(end))
    );

    let revenue = 0;
    let cogs = 0;
    let expenses = 0;
    let cashIn = 0;
    let cashOut = 0;

    for (const doc of movementsSnap.docs) {
      const movement = doc.data() as MovementDoc;
      const amount = Number(movement.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      if (movement.type === "SALE_REVENUE") revenue += amount;
      if (movement.type === "COGS") cogs += amount;
      if (movement.type === "OPERATING_EXPENSE") expenses += amount;

      // Money that really came in or went out (cash-effect.ts), not every movement by direction.
      const cash = cashEffect(movement);
      cashIn += cash.cashIn;
      cashOut += cash.cashOut;
    }

    const grossProfit = revenue - cogs;
    const netResult = grossProfit - expenses;

    const inventoryValue = productsSnap.docs.reduce((sum, doc) => {
      const data = doc.data() as { stock?: number; costPrice?: number };
      const stock = Number(data.stock || 0);
      const costPrice = Number(data.costPrice || 0);
      return sum + stock * costPrice;
    }, 0);

    const fiadoOutstanding = ordersSnap.docs.reduce((sum, doc) => {
      const data = doc.data() as {
        isPaidLater?: boolean;
        remainingAmount?: number;
        totalAmount?: number;
        amountPaid?: number;
      };

      if (!data.isPaidLater) return sum;

      if (typeof data.remainingAmount === "number") {
        return sum + data.remainingAmount;
      }

      const totalAmount = Number(data.totalAmount || 0);
      const amountPaid = Number(data.amountPaid || 0);
      return sum + Math.max(0, totalAmount - amountPaid);
    }, 0);

    // ALL WRITES AFTER ALL READS
    const lockedAt = Timestamp.fromDate(new Date());

    tx.set(closureRef, {
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
      lockedAt,
      lockedBy: actorId,
    });

    createFinancialAuditLog(
      {
        action: "FINANCIAL_CLOSE",
        actorId,
        actorRole,
        occurredAt: lockedAt.toDate(),
        competencyMonth: month,
        relatedEntity: { kind: "financialClosure", id: month },
        payload: { revenue, cogs, grossProfit, expenses, netResult, cashIn, cashOut, inventoryValue, fiadoOutstanding },
      },
      tx
    );

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
  });
}

function aggregateMonth(month: string, movements: MovementDoc[]): MonthAggregation {
  let revenue = 0;
  let cogs = 0;
  let expenses = 0;
  let stockPurchases = 0;
  let fiadoPayments = 0;
  let exchangeDifference = 0;
  let cashIn = 0;
  let cashOut = 0;

  for (const movement of movements) {
    const amount = Number(movement.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const cash = cashEffect(movement);
    cashIn += cash.cashIn;
    cashOut += cash.cashOut;

    if (movement.type === "SALE_REVENUE") revenue += amount;
    if (movement.type === "COGS") cogs += amount;
    if (movement.type === "OPERATING_EXPENSE") expenses += amount;
    if (movement.type === "STOCK_PURCHASE") stockPurchases += amount;
    if (movement.type === "FIADO_PAYMENT") fiadoPayments += amount;
    if (movement.type === "EXCHANGE_DIFFERENCE") exchangeDifference += amount;
  }

  return {
    month,
    movementCount: movements.length,
    revenue,
    cogs,
    expenses,
    stockPurchases,
    fiadoPayments,
    exchangeDifference,
    cashIn,
    cashOut,
    netResult: revenue - cogs - expenses,
  };
}

function detectMonthAnomalies(movements: MovementDoc[], aggregation: MonthAggregation): string[] {
  const anomalies: string[] = [];

  if (aggregation.revenue > 0 && aggregation.cogs === 0) {
    anomalies.push("Revenue exists without COGS movements");
  }

  if (aggregation.movementCount === 0) {
    anomalies.push("No financial movements in month");
  }

  const saleByOrder = new Map<string, number>();
  const cogsByOrder = new Map<string, number>();

  for (const movement of movements) {
    const orderId = movement.relatedEntity?.kind === "order" ? movement.relatedEntity.id || "" : "";
    if (!orderId) continue;

    if (movement.type === "SALE_REVENUE") {
      saleByOrder.set(orderId, (saleByOrder.get(orderId) || 0) + 1);
    }

    if (movement.type === "COGS") {
      cogsByOrder.set(orderId, (cogsByOrder.get(orderId) || 0) + 1);
    }
  }

  const duplicatedSales = Array.from(saleByOrder.entries()).filter(([, count]) => count > 1).length;
  if (duplicatedSales > 0) {
    anomalies.push(`Duplicated SALE_REVENUE movements for ${duplicatedSales} orders`);
  }

  const missingCogs = Array.from(saleByOrder.keys()).filter((orderId) => (cogsByOrder.get(orderId) || 0) === 0).length;
  if (missingCogs > 0) {
    anomalies.push(`Missing COGS movement for ${missingCogs} sold orders`);
  }

  return anomalies;
}

/**
 * Rolling reconciliation job: recomputes the last 13 months of aggregates, flags anomalies,
 * and (if not already closed) writes a preview of what closing last month would look like.
 * Not wrapped in a transaction — each month's aggregate/preview write is independent and
 * naturally idempotent (plain overwrite), unlike closeFinancialMonth's single invariant.
 */
export async function runFinancialHealthCheck(input: RunHealthCheckCommand): Promise<HealthCheckResult> {
  const { actorId, actorRole } = input;
  const months = listRecentMonths(13);
  const now = Timestamp.now();

  const monthlyAggregations: MonthAggregation[] = [];
  const anomalyRows: AnomalyRow[] = [];

  for (const month of months) {
    const movementSnapshot = await adminDb
      .collection("financialMovements")
      .where("competencyMonth", "==", month)
      .get();

    const movements = movementSnapshot.docs.map((doc) => doc.data() as MovementDoc);
    const aggregation = aggregateMonth(month, movements);
    monthlyAggregations.push(aggregation);

    await adminDb.collection("financialMonthlyAggregates").doc(month).set({
      ...aggregation,
      updatedAt: now,
      updatedBy: actorId,
    });

    const anomalies = detectMonthAnomalies(movements, aggregation);
    if (anomalies.length > 0) {
      anomalyRows.push({
        month,
        issues: anomalies,
        severity: anomalies.some((issue) => issue.includes("Duplicated") || issue.includes("Missing COGS"))
          ? "high"
          : "warning",
      });
    }
  }

  const openMonth = toCompetencyMonth(new Date());
  const previewMonth = previousMonth(openMonth);
  const closureSnapshot = await adminDb.collection("financialClosures").doc(previewMonth).get();

  let closurePreviewCreated = false;
  if (!closureSnapshot.exists) {
    const previewAggregate = monthlyAggregations.find((item) => item.month === previewMonth);
    if (previewAggregate) {
      await adminDb.collection("financialClosurePreviews").doc(previewMonth).set({
        month: previewMonth,
        source: "automation",
        revenue: previewAggregate.revenue,
        cogs: previewAggregate.cogs,
        grossProfit: previewAggregate.revenue - previewAggregate.cogs,
        expenses: previewAggregate.expenses,
        netResult: previewAggregate.netResult,
        cashIn: previewAggregate.cashIn,
        cashOut: previewAggregate.cashOut,
        generatedAt: now,
        generatedBy: actorId,
      });
      closurePreviewCreated = true;
    }
  }

  const runRef = adminDb.collection("financialAutomationRuns").doc();
  await runRef.set({
    actorId,
    actorRole,
    executedAt: now,
    aggregatedMonths: months,
    closurePreviewMonth: previewMonth,
    closurePreviewCreated,
    anomalyCount: anomalyRows.length,
    anomalies: anomalyRows,
  });

  return {
    runId: runRef.id,
    aggregatedMonths: months.length,
    closurePreviewMonth: previewMonth,
    closurePreviewCreated,
    anomalyCount: anomalyRows.length,
    anomalies: anomalyRows,
  };
}
