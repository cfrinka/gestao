import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { verifyAuth } from "@/lib/auth-api";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { adminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

type MovementDoc = {
  type?: string;
  direction?: "IN" | "OUT";
  amount?: number;
  competencyMonth?: string;
  relatedEntity?: { kind?: string; id?: string };
};

type MonthAggregation = {
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
};

function toCompetencyMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function previousMonth(month: string): string {
  const [yearRaw, monthRaw] = month.split("-");
  const dt = new Date(Number(yearRaw), Number(monthRaw) - 1, 1);
  dt.setMonth(dt.getMonth() - 1);
  return toCompetencyMonth(dt);
}

function listRecentMonths(lastN: number): string[] {
  const months: string[] = [];
  const cursor = new Date();
  cursor.setDate(1);

  for (let i = 0; i < lastN; i += 1) {
    const target = new Date(cursor);
    target.setMonth(target.getMonth() - i);
    months.push(toCompetencyMonth(target));
  }

  return months;
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

    if (movement.direction === "IN") cashIn += amount;
    if (movement.direction === "OUT") cashOut += amount;

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

function detectMonthAnomalies(month: string, movements: MovementDoc[], aggregation: MonthAggregation): string[] {
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

async function resolveActor(request: NextRequest): Promise<{ uid: string; email: string; role: string } | null> {
  const cronSecret = request.headers.get("x-automation-secret") || "";
  const configuredSecret = process.env.FINANCIAL_AUTOMATION_SECRET || "";

  if (configuredSecret && cronSecret && cronSecret === configuredSecret) {
    return { uid: "automation", email: "", role: "SYSTEM" };
  }

  return verifyAuth(request);
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ user }) => {
      const months = listRecentMonths(13);
      const now = Timestamp.now();

      const monthlyAggregations: MonthAggregation[] = [];
      const anomalyRows: Array<{ month: string; issues: string[]; severity: "info" | "warning" | "high" }> = [];

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
          updatedBy: user.uid,
        });

        const anomalies = detectMonthAnomalies(month, movements, aggregation);
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
            generatedBy: user.uid,
          });
          closurePreviewCreated = true;
        }
      }

      const runRef = adminDb.collection("financialAutomationRuns").doc();
      await runRef.set({
        actorId: user.uid,
        actorRole: user.role,
        executedAt: now,
        aggregatedMonths: months,
        closurePreviewMonth: previewMonth,
        closurePreviewCreated,
        anomalyCount: anomalyRows.length,
        anomalies: anomalyRows,
      });

      return NextResponse.json({
        runId: runRef.id,
        aggregatedMonths: months.length,
        closurePreviewMonth: previewMonth,
        closurePreviewCreated,
        anomalyCount: anomalyRows.length,
        anomalies: anomalyRows,
      });
    },
    {
      roles: ["ADMIN", "SYSTEM"],
      operationName: "automation financial-health post",
      authorize: resolveActor,
    }
  );
}
