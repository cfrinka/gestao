export type { IdempotencyReservation } from "@/domains/shared/idempotency";

export interface CreateBillCommand {
  userId: string;
  idempotencyKey: string;
  kind: unknown;
  name: unknown;
  amount: unknown;
  dayOfMonth?: unknown;
  monthsAhead?: unknown;
  startMonth?: unknown;
  dueDate?: unknown;
  firstDueDate?: unknown;
  installmentsCount?: unknown;
  intervalMonths?: unknown;
}

export interface CreateBillResult {
  kind: string;
  id?: string;
  groupId?: string;
  createdIds?: string[];
}

export interface BillRecord {
  id: string;
  name: string;
  amount: number;
  status: string;
  kind: string;
  dueDate?: unknown;
  paidAt?: unknown;
  paidMethod?: string;
  groupId?: string;
  installmentNumber?: number;
  installmentsCount?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ListBillsQuery {
  month: string | null;
  status: string;
}

export interface MarkBillPaidCommand {
  billId: string;
  method: unknown;
  actorId: string;
  actorRole: string;
}

export interface MarkBillUnpaidCommand {
  billId: string;
  actorId: string;
  actorRole: string;
}

export interface DeleteBillCommand {
  billId: string;
  actorId: string;
  actorRole: string;
}

export type BillPaymentMethod = "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX";

export type BillExecutionResult =
  | { status: 200 | 201; body: unknown }
  | { status: 409; body: { error: string } };
