import { randomUUID } from "crypto";
import type { BillsRepository } from "@/domains/bills/repository";
import type { BillPaymentMethod, BillRecord, IdempotencyReservation, ListBillsQuery } from "@/domains/bills/types";

/**
 * Mirrors demo-store.ts's IdempotencyEntry shape structurally. Declared locally (instead of
 * importing demo-store.ts) so this repository stays a pure, Map-driven class with no
 * dependency on session/request wiring.
 */
export interface IdempotencyEntry {
  requestHash: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  response?: unknown;
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

/**
 * In-memory equivalent of FirestoreBillsRepository for demo mode. Constructed fresh per
 * request but always points at the same session-scoped Maps, so state persists across
 * requests within a demo session.
 */
export class InMemoryBillsRepository implements BillsRepository {
  constructor(
    private bills: Map<string, BillRecord>,
    private idempotency: Map<string, IdempotencyEntry>
  ) {}

  async reserveIdempotency(input: {
    ownerId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<IdempotencyReservation> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotency.get(key);
    if (!existing) {
      this.idempotency.set(key, { requestHash: input.requestHash, status: "PROCESSING" });
      return { type: "new" };
    }
    if (existing.requestHash !== input.requestHash) return { type: "conflict" };
    if (existing.status === "COMPLETED") return { type: "completed", response: existing.response };
    if (existing.status === "PROCESSING") return { type: "in_progress" };
    existing.status = "PROCESSING";
    return { type: "new" };
  }

  async markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }): Promise<void> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotency.get(key);
    if (existing) {
      existing.status = "COMPLETED";
      existing.response = input.response;
    }
  }

  async markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }): Promise<void> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotency.get(key);
    if (existing) existing.status = "FAILED";
  }

  async createFixedBills(params: {
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

    const groupId = randomUUID();
    const createdIds: string[] = [];

    for (let i = 0; i < monthsAhead; i += 1) {
      const m = addMonths(start, i);
      const due = clampDay(m.getFullYear(), m.getMonth(), dayOfMonth);
      const id = randomUUID();
      createdIds.push(id);

      this.bills.set(id, {
        id,
        name,
        amount,
        dueDate: due,
        status: "PENDING",
        kind: "FIXED",
        groupId,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { groupId, createdIds };
  }

  async createOneTimeBill(params: { name: string; amount: number; dueDate: string }): Promise<{ id: string }> {
    const { name, amount, dueDate } = params;
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) {
      throw new Error("Invalid dueDate");
    }

    const now = new Date();
    const id = randomUUID();
    this.bills.set(id, {
      id,
      name,
      amount,
      dueDate: due,
      status: "PENDING",
      kind: "ONE_TIME",
      createdAt: now,
      updatedAt: now,
    });

    return { id };
  }

  async createInstallments(params: {
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
    const groupId = randomUUID();
    const createdIds: string[] = [];

    for (let i = 0; i < installmentsCount; i += 1) {
      const due = addMonths(first, i * intervalMonths);
      const id = randomUUID();
      createdIds.push(id);

      this.bills.set(id, {
        id,
        name,
        amount,
        dueDate: due,
        status: "PENDING",
        kind: "INSTALLMENT",
        groupId,
        installmentNumber: i + 1,
        installmentsCount,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { groupId, createdIds };
  }

  async listBills(query: ListBillsQuery): Promise<BillRecord[]> {
    const { start, end } = parseMonth(query.month);

    let bills = Array.from(this.bills.values());
    if (start && end) {
      bills = bills.filter((b) => {
        const due = b.dueDate instanceof Date ? b.dueDate : new Date(String(b.dueDate));
        return due >= start && due < end;
      });
    }

    bills = bills.slice().sort((a, b) => {
      const dueA = a.dueDate instanceof Date ? a.dueDate.getTime() : new Date(String(a.dueDate)).getTime();
      const dueB = b.dueDate instanceof Date ? b.dueDate.getTime() : new Date(String(b.dueDate)).getTime();
      return dueA - dueB;
    });

    const status = query.status.toLowerCase();
    return bills.filter((b) => {
      const s = typeof b.status === "string" ? b.status.toUpperCase() : "";
      if (status === "paid") return s === "PAID";
      if (status === "pending" || status === "unpaid") return s === "PENDING";
      return true;
    });
  }

  async getBill(billId: string): Promise<{ exists: boolean }> {
    return { exists: this.bills.has(billId) };
  }

  async markBillPaid(input: { billId: string; method: string; actorId: string }): Promise<BillRecord> {
    const bill = this.bills.get(input.billId);
    if (!bill) {
      throw new Error("Bill not found");
    }
    if (bill.status === "PAID") {
      return { ...bill };
    }

    const now = new Date();
    const updated: BillRecord = {
      ...bill,
      status: "PAID",
      paidAt: now,
      paidMethod: input.method as BillPaymentMethod,
      updatedAt: now,
    };
    this.bills.set(input.billId, updated);
    return { ...updated };
  }

  async markBillUnpaid(input: { billId: string; actorId: string }): Promise<BillRecord> {
    const bill = this.bills.get(input.billId);
    if (!bill) {
      throw new Error("Bill not found");
    }

    const now = new Date();
    const updated: BillRecord = {
      ...bill,
      status: "PENDING",
      paidAt: undefined,
      paidMethod: undefined,
      updatedAt: now,
    };
    this.bills.set(input.billId, updated);
    return { ...updated };
  }

  async deleteBill(input: { billId: string; actorId: string }): Promise<void> {
    if (!this.bills.has(input.billId)) {
      throw new Error("Bill not found");
    }
    this.bills.delete(input.billId);
  }
}
