import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { createFinancialAuditLog } from "@/lib/db";

export const dynamic = "force-dynamic";

function toCompetencyMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function isValidCompetencyMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function getMonthDateRange(month: string): { start: Date; end: Date } {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;

  const start = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);

  return { start, end };
}

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as { month?: string };
    const month = (body.month || "").trim();

    if (!isValidCompetencyMonth(month)) {
      return NextResponse.json({ error: "Invalid month. Expected YYYY-MM" }, { status: 400 });
    }

    const currentMonth = toCompetencyMonth(new Date());
    if (month === currentMonth) {
      return NextResponse.json({ error: "Current month cannot be closed" }, { status: 400 });
    }

    const closureRef = adminDb.collection("financialClosures").doc(month);
    const existing = await closureRef.get();
    if (existing.exists) {
      return NextResponse.json({ error: `Month ${month} is already closed` }, { status: 409 });
    }

    const movementsSnapshot = await adminDb
      .collection("financialMovements")
      .where("competencyMonth", "==", month)
      .get();

    let revenue = 0;
    let cogs = 0;
    let expenses = 0;
    let cashIn = 0;
    let cashOut = 0;

    for (const doc of movementsSnapshot.docs) {
      const movement = doc.data() as {
        type?: string;
        direction?: "IN" | "OUT";
        amount?: number;
      };

      const amount = Number(movement.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      if (movement.type === "SALE_REVENUE") revenue += amount;
      if (movement.type === "COGS") cogs += amount;
      if (movement.type === "OPERATING_EXPENSE") expenses += amount;

      if (movement.direction === "IN") cashIn += amount;
      if (movement.direction === "OUT") cashOut += amount;
    }

    const grossProfit = revenue - cogs;
    const netResult = grossProfit - expenses;

    const { end } = getMonthDateRange(month);

    const [productsSnapshot, ordersSnapshot] = await Promise.all([
      adminDb.collection("products").get(),
      adminDb.collection("orders").where("createdAt", "<=", Timestamp.fromDate(end)).get(),
    ]);

    const inventoryValue = productsSnapshot.docs.reduce((sum, doc) => {
      const data = doc.data() as { stock?: number; costPrice?: number };
      const stock = Number(data.stock || 0);
      const costPrice = Number(data.costPrice || 0);
      return sum + stock * costPrice;
    }, 0);

    const fiadoOutstanding = ordersSnapshot.docs.reduce((sum, doc) => {
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

    const lockedAt = Timestamp.fromDate(new Date());

    await closureRef.set({
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
      lockedBy: user.uid,
    });

    await createFinancialAuditLog({
      action: "FINANCIAL_CLOSE",
      actorId: user.uid,
      actorRole: user.role,
      occurredAt: lockedAt.toDate(),
      competencyMonth: month,
      relatedEntity: { kind: "financialClosure", id: month },
      payload: {
        revenue,
        cogs,
        grossProfit,
        expenses,
        netResult,
        cashIn,
        cashOut,
        inventoryValue,
        fiadoOutstanding,
      },
    });

    return NextResponse.json(
      {
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
        lockedBy: user.uid,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error closing financial month:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
