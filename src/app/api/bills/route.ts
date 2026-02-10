import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

type BillStatus = "PENDING" | "PAID";

type BillDoc = {
  name: string;
  amount: number;
  dueDate: Timestamp;
  status: BillStatus;
  kind: "FIXED" | "ONE_TIME" | "INSTALLMENT";
  groupId?: string;
  installmentNumber?: number;
  installmentsCount?: number;
  paidAt?: Timestamp;
  paidMethod?: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX";
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

function parseMonth(month: string | null): { start?: Date; end?: Date } {
  if (!month) return {};
  const m = month.trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return {};
  const [y, mo] = m.split("-").map((v) => parseInt(v, 10));
  const start = new Date(y, mo - 1, 1);
  const end = new Date(y, mo, 1);
  return { start, end };
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function clampDay(year: number, monthIndex: number, day: number): Date {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const d = Math.min(Math.max(1, day), lastDay);
  return new Date(year, monthIndex, d);
}

async function createFixedBills(params: {
  name: string;
  amount: number;
  dayOfMonth: number;
  startMonth?: string;
  monthsAhead: number;
}) {
  const { name, amount, dayOfMonth, startMonth, monthsAhead } = params;

  const now = new Date();
  const monthInfo = parseMonth(startMonth || null);
  const start = monthInfo.start || new Date(now.getFullYear(), now.getMonth(), 1);

  const groupId = adminDb.collection("bills").doc().id;

  const batch = adminDb.batch();
  const createdIds: string[] = [];

  for (let i = 0; i < monthsAhead; i += 1) {
    const m = addMonths(start, i);
    const due = clampDay(m.getFullYear(), m.getMonth(), dayOfMonth);

    const ref = adminDb.collection("bills").doc();
    createdIds.push(ref.id);

    const doc: BillDoc = {
      name,
      amount,
      dueDate: Timestamp.fromDate(due),
      status: "PENDING",
      kind: "FIXED",
      groupId,
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
    };

    batch.set(ref, doc);
  }

  await batch.commit();
  return { groupId, createdIds };
}

async function createOneTimeBill(params: { name: string; amount: number; dueDate: string }) {
  const { name, amount, dueDate } = params;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) {
    throw new Error("Invalid dueDate");
  }

  const now = new Date();
  const ref = adminDb.collection("bills").doc();

  const doc: BillDoc = {
    name,
    amount,
    dueDate: Timestamp.fromDate(due),
    status: "PENDING",
    kind: "ONE_TIME",
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  };

  await ref.set(doc);
  return { id: ref.id };
}

async function createInstallments(params: {
  name: string;
  amount: number;
  firstDueDate: string;
  installmentsCount: number;
  intervalMonths: number;
}) {
  const { name, amount, firstDueDate, installmentsCount, intervalMonths } = params;
  const first = new Date(firstDueDate);
  if (Number.isNaN(first.getTime())) {
    throw new Error("Invalid firstDueDate");
  }
  if (!Number.isFinite(installmentsCount) || installmentsCount <= 0) {
    throw new Error("Invalid installmentsCount");
  }

  const now = new Date();
  const groupId = adminDb.collection("bills").doc().id;

  const batch = adminDb.batch();
  const createdIds: string[] = [];

  for (let i = 0; i < installmentsCount; i += 1) {
    const due = addMonths(first, i * intervalMonths);
    const ref = adminDb.collection("bills").doc();
    createdIds.push(ref.id);

    const doc: BillDoc = {
      name,
      amount,
      dueDate: Timestamp.fromDate(due),
      status: "PENDING",
      kind: "INSTALLMENT",
      groupId,
      installmentNumber: i + 1,
      installmentsCount,
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
    };

    batch.set(ref, doc);
  }

  await batch.commit();
  return { groupId, createdIds };
}

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) return unauthorizedResponse();
    if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month");
    const status = (searchParams.get("status") || "all").toLowerCase();

    const { start, end } = parseMonth(month);

    let q: FirebaseFirestore.Query = adminDb.collection("bills");

    if (start && end) {
      q = q.where("dueDate", ">=", Timestamp.fromDate(start)).where("dueDate", "<", Timestamp.fromDate(end));
    }

    q = q.orderBy("dueDate", "asc");

    const snapshot = await q.get();
    const billsRaw = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

    const bills = billsRaw.filter((b) => {
      const statusValue = (b as unknown as { status?: unknown }).status;
      const s = typeof statusValue === "string" ? statusValue.toUpperCase() : "";
      if (status === "paid") return s === "PAID";
      if (status === "pending" || status === "unpaid") return s === "PENDING";
      return true;
    });

    return NextResponse.json(bills);
  } catch (error) {
    console.error("Error fetching bills:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) return unauthorizedResponse();
    if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const kindRaw = typeof body.kind === "string" ? body.kind : "";
    const kind = kindRaw.toUpperCase();

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const amount = typeof body.amount === "number" ? body.amount : parseFloat(String(body.amount || 0));

    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Amount is invalid" }, { status: 400 });

    if (kind === "FIXED") {
      const dayOfMonth = typeof body.dayOfMonth === "number" ? body.dayOfMonth : parseInt(String(body.dayOfMonth || ""), 10);
      const monthsAhead = typeof body.monthsAhead === "number" ? body.monthsAhead : parseInt(String(body.monthsAhead || ""), 10);
      const startMonth = typeof body.startMonth === "string" ? body.startMonth : undefined;

      if (!Number.isFinite(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        return NextResponse.json({ error: "dayOfMonth is invalid" }, { status: 400 });
      }

      const safeMonthsAhead = Number.isFinite(monthsAhead) && monthsAhead > 0 ? Math.min(36, monthsAhead) : 12;
      const created = await createFixedBills({ name, amount, dayOfMonth, startMonth, monthsAhead: safeMonthsAhead });
      return NextResponse.json({ kind: "FIXED", ...created });
    }

    if (kind === "ONE_TIME") {
      const dueDate = typeof body.dueDate === "string" ? body.dueDate : "";
      if (!dueDate) return NextResponse.json({ error: "dueDate is required" }, { status: 400 });
      const created = await createOneTimeBill({ name, amount, dueDate });
      return NextResponse.json({ kind: "ONE_TIME", ...created });
    }

    if (kind === "INSTALLMENTS" || kind === "INSTALLMENT") {
      const firstDueDate = typeof body.firstDueDate === "string" ? body.firstDueDate : "";
      const installmentsCount = typeof body.installmentsCount === "number"
        ? body.installmentsCount
        : parseInt(String(body.installmentsCount || ""), 10);
      const intervalMonths = typeof body.intervalMonths === "number"
        ? body.intervalMonths
        : parseInt(String(body.intervalMonths || ""), 10);

      if (!firstDueDate) return NextResponse.json({ error: "firstDueDate is required" }, { status: 400 });
      if (!Number.isFinite(installmentsCount) || installmentsCount <= 0) {
        return NextResponse.json({ error: "installmentsCount is invalid" }, { status: 400 });
      }
      const safeInterval = Number.isFinite(intervalMonths) && intervalMonths > 0 ? Math.min(12, intervalMonths) : 1;
      const safeCount = Math.min(60, installmentsCount);

      const created = await createInstallments({
        name,
        amount,
        firstDueDate,
        installmentsCount: safeCount,
        intervalMonths: safeInterval,
      });

      return NextResponse.json({ kind: "INSTALLMENTS", ...created });
    }

    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  } catch (error) {
    console.error("Error creating bill(s):", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
