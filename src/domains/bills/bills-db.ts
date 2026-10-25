import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { assertFinancialMonthOpenTx, toCompetencyMonth } from "@/domains/financial/financial-db";
import type { BillPaymentMethod, BillRecord } from "@/domains/bills/types";
import { HttpError } from "@/lib/api/http-errors";
import { addMonthsISO, currentMonthISO, storeMonthRange, storeTimeToDate } from "@/lib/dates";

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

/** A due date is a store calendar day, stored as 00:00 of that day in Brasília. */
function dueDateOn(month: string, day: number): Date {
  const [year, monthNumber] = month.split("-").map((v) => parseInt(v, 10));
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return storeTimeToDate(year, monthNumber, Math.min(Math.max(1, day), lastDay));
}

function parseDueDate(value: string): { month: string; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  return { month: `${match[1]}-${match[2]}`, day: Number(match[3]) };
}

/**
 * Bills created before due dates were stored in store time hold midnight UTC of the intended
 * day (`new Date("2026-11-10")`), which reads as the 9th at 21:00 in Brasília. Those are exactly
 * midnight UTC, which a store-time date never is, so they are read back as the day they meant.
 */
function normalizeLegacyDueDate(dueDate: Date): Date {
  const isUtcMidnight =
    dueDate.getUTCHours() === 0 &&
    dueDate.getUTCMinutes() === 0 &&
    dueDate.getUTCSeconds() === 0 &&
    dueDate.getUTCMilliseconds() === 0;
  if (!isUtcMidnight) return dueDate;
  return storeTimeToDate(dueDate.getUTCFullYear(), dueDate.getUTCMonth() + 1, dueDate.getUTCDate());
}

const LEGACY_DUE_DATE_SLACK_MS = 3 * 60 * 60 * 1000;

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
  const firstMonth = startMonth && /^\d{4}-\d{2}$/.test(startMonth.trim()) ? startMonth.trim() : currentMonthISO();

  const groupId = adminDb.collection("bills").doc().id;

  const batch = adminDb.batch();
  const createdIds: string[] = [];

  for (let i = 0; i < monthsAhead; i += 1) {
    const due = dueDateOn(addMonthsISO(firstMonth, i), dayOfMonth);

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
  const parsed = parseDueDate(String(dueDate || ""));
  if (!parsed) {
    throw new HttpError(400, "Data de vencimento inválida");
  }
  const due = dueDateOn(parsed.month, parsed.day);

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
  const first = parseDueDate(String(firstDueDate || ""));
  if (!first) {
    throw new HttpError(400, "Data do primeiro vencimento inválida");
  }
  if (!Number.isFinite(installmentsCount) || installmentsCount <= 0) {
    throw new HttpError(400, "Número de parcelas inválido");
  }

  const now = new Date();
  const groupId = adminDb.collection("bills").doc().id;

  const batch = adminDb.batch();
  const createdIds: string[] = [];

  for (let i = 0; i < installmentsCount; i += 1) {
    const due = dueDateOn(addMonthsISO(first.month, i * intervalMonths), first.day);
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
  const range = filters.month ? storeMonthRange(filters.month.trim()) : null;

  let q: FirebaseFirestore.Query = adminDb.collection("bills");
  if (range) {
    // Widened by three hours so a legacy midnight-UTC bill due on the 1st is found, then every
    // due date is normalized and filtered against the real month.
    q = q
      .where("dueDate", ">=", Timestamp.fromDate(new Date(range.start.getTime() - LEGACY_DUE_DATE_SLACK_MS)))
      .where("dueDate", "<=", Timestamp.fromDate(range.end));
  }
  q = q.orderBy("dueDate", "asc");

  const snapshot = await q.get();
  const billsRaw = snapshot.docs
    .map((d) => {
      const data = d.data();
      const rawDue = data.dueDate as Timestamp | undefined;
      const dueDate = rawDue?.toDate ? normalizeLegacyDueDate(rawDue.toDate()) : null;
      return { id: d.id, ...data, ...(dueDate ? { dueDate: Timestamp.fromDate(dueDate) } : {}), _due: dueDate };
    })
    .filter((b) => !range || (b._due && b._due >= range.start && b._due <= range.end))
    .map(({ _due, ...bill }) => bill) as unknown as BillRecord[];

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
      throw new HttpError(404, "Conta não encontrada");
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
      throw new HttpError(404, "Conta não encontrada");
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
      throw new HttpError(404, "Conta não encontrada");
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
