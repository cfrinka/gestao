import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { assertFinancialMonthOpenTx, toCompetencyMonth } from "@/domains/financial/financial-db";
import type { BillPaymentMethod, BillRecord } from "@/domains/bills/types";

type BillStatus = "PENDING" | "PAID";

interface BillDoc {
  name: string;
  amount: number;
  dueDate: Timestamp;
  status: BillStatus;
  kind: "FIXED" | "ONE_TIME" | "INSTALLMENT";
  groupId?: string;
  installmentNumber?: number;
  installmentsCount?: number;
  paidAt?: Timestamp;
  paidMethod?: BillPaymentMethod;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

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

function mapBillMethodToFinancial(method: BillPaymentMethod) {
  if (method === "DINHEIRO") return "cash";
  if (method === "PIX") return "pix";
  if (method === "CREDITO") return "credit";
  return "debit";
}

export async function createFixedBills(params: {
  name: string;
  amount: number;
  dayOfMonth: number;
  startMonth?: string;
  monthsAhead: number;
}): Promise<{ groupId: string; createdIds: string[] }> {
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

export async function createOneTimeBill(params: {
  name: string;
  amount: number;
  dueDate: string;
}): Promise<{ id: string }> {
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

export async function createInstallments(params: {
  name: string;
  amount: number;
  firstDueDate: string;
  installmentsCount: number;
  intervalMonths: number;
}): Promise<{ groupId: string; createdIds: string[] }> {
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

export async function listBills(filters: { month: string | null; status: string }): Promise<BillRecord[]> {
  const { start, end } = parseMonth(filters.month);

  let q: FirebaseFirestore.Query = adminDb.collection("bills");
  if (start && end) {
    q = q.where("dueDate", ">=", Timestamp.fromDate(start)).where("dueDate", "<", Timestamp.fromDate(end));
  }
  q = q.orderBy("dueDate", "asc");

  const snapshot = await q.get();
  const billsRaw = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as unknown as BillRecord[];

  const status = filters.status.toLowerCase();
  return billsRaw.filter((b) => {
    const s = typeof b.status === "string" ? b.status.toUpperCase() : "";
    if (status === "paid") return s === "PAID";
    if (status === "pending" || status === "unpaid") return s === "PENDING";
    return true;
  });
}

/**
 * Reads (but does not write) the live OPERATING_EXPENSE movement for a paid bill, and asserts
 * that the month it was paid in isn't already closed. Must be called before any writes in the
 * same transaction (Firestore requires all reads before any write).
 */
async function readBillExpenseMovementForReversal(
  tx: FirebaseFirestore.Transaction,
  billId: string,
  billData: { status?: string; paidAt?: unknown }
): Promise<FirebaseFirestore.QueryDocumentSnapshot | undefined> {
  if (billData.status !== "PAID") return undefined;

  const paidAtRaw = billData.paidAt as { toDate?: () => Date } | null | undefined;
  const paidAt = paidAtRaw?.toDate ? paidAtRaw.toDate() : null;
  if (paidAt) {
    await assertFinancialMonthOpenTx(tx, paidAt);
  }

  const movementsSnap = await tx.get(
    adminDb
      .collection("financialMovements")
      .where("type", "==", "OPERATING_EXPENSE")
      .where("relatedEntity.id", "==", billId)
      .limit(1)
  );
  return movementsSnap.docs[0];
}

function reverseBillExpenseMovement(
  tx: FirebaseFirestore.Transaction,
  movementDoc: FirebaseFirestore.QueryDocumentSnapshot,
  actorId: string,
  nowTs: Timestamp
) {
  tx.update(movementDoc.ref, {
    amount: 0,
    metadata: {
      ...(movementDoc.data().metadata || {}),
      reversed: true,
      reversedAt: nowTs,
      reversedBy: actorId,
    },
  });
}

export async function markBillPaid(input: {
  billId: string;
  method: BillPaymentMethod;
  actorId: string;
}): Promise<BillRecord> {
  const ref = adminDb.collection("bills").doc(input.billId);
  const now = new Date();

  await adminDb.runTransaction(async (tx) => {
    await assertFinancialMonthOpenTx(tx, now);

    const billSnap = await tx.get(ref);
    if (!billSnap.exists) {
      throw new Error("Bill not found");
    }

    const current = billSnap.data() as { status?: string; amount?: number; name?: string };
    if (current?.status === "PAID") {
      return;
    }

    const paidAt = Timestamp.fromDate(now);
    tx.update(ref, {
      status: "PAID",
      paidAt,
      paidMethod: input.method,
      updatedAt: paidAt,
    });

    const amount = Number(current?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }

    const movementRef = adminDb.collection("financialMovements").doc();
    tx.set(movementRef, {
      type: "OPERATING_EXPENSE",
      direction: "OUT",
      amount,
      paymentMethod: mapBillMethodToFinancial(input.method),
      relatedEntity: { kind: "bill", id: input.billId },
      occurredAt: paidAt,
      competencyMonth: toCompetencyMonth(now),
      createdBy: input.actorId,
      metadata: {
        billName: current?.name || "",
        paidMethod: input.method,
      },
    });
  });

  const updated = await ref.get();
  return { id: updated.id, ...updated.data() } as unknown as BillRecord;
}

export async function markBillUnpaid(input: { billId: string; actorId: string }): Promise<BillRecord> {
  const ref = adminDb.collection("bills").doc(input.billId);
  const now = new Date();

  await adminDb.runTransaction(async (tx) => {
    const billSnap = await tx.get(ref);
    if (!billSnap.exists) {
      throw new Error("Bill not found");
    }
    const current = billSnap.data() as { status?: string; paidAt?: unknown };
    const movementDoc = await readBillExpenseMovementForReversal(tx, input.billId, current);

    // ALL WRITES AFTER ALL READS
    const nowTs = Timestamp.fromDate(now);
    tx.update(ref, {
      status: "PENDING",
      paidAt: null,
      paidMethod: null,
      updatedAt: nowTs,
    });

    if (movementDoc) {
      reverseBillExpenseMovement(tx, movementDoc, input.actorId, nowTs);
    }
  });

  const updated = await ref.get();
  return { id: updated.id, ...updated.data() } as unknown as BillRecord;
}

export async function deleteBill(input: { billId: string; actorId: string }): Promise<void> {
  const ref = adminDb.collection("bills").doc(input.billId);

  await adminDb.runTransaction(async (tx) => {
    const billSnap = await tx.get(ref);
    if (!billSnap.exists) {
      throw new Error("Bill not found");
    }
    const current = billSnap.data() as { status?: string; paidAt?: unknown };
    const movementDoc = await readBillExpenseMovementForReversal(tx, input.billId, current);

    // ALL WRITES AFTER ALL READS
    if (movementDoc) {
      reverseBillExpenseMovement(tx, movementDoc, input.actorId, Timestamp.fromDate(new Date()));
    }
    tx.delete(ref);
  });
}

export async function getBill(billId: string): Promise<{ exists: boolean }> {
  const doc = await adminDb.collection("bills").doc(billId).get();
  return { exists: doc.exists };
}
