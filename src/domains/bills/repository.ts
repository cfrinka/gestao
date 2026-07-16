import type { BillRecord, IdempotencyReservation, ListBillsQuery } from "@/domains/bills/types";

export interface BillsRepository {
  reserveIdempotency(input: { ownerId: string; idempotencyKey: string; requestHash: string }): Promise<IdempotencyReservation>;
  markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }): Promise<void>;
  markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }): Promise<void>;

  createFixedBills(params: {
    name: string;
    amount: number;
    dayOfMonth: number;
    startMonth?: string;
    monthsAhead: number;
  }): Promise<{ groupId: string; createdIds: string[] }>;

  createOneTimeBill(params: { name: string; amount: number; dueDate: string }): Promise<{ id: string }>;

  createInstallments(params: {
    name: string;
    amount: number;
    firstDueDate: string;
    installmentsCount: number;
    intervalMonths: number;
  }): Promise<{ groupId: string; createdIds: string[] }>;

  listBills(query: ListBillsQuery): Promise<BillRecord[]>;
  getBill(billId: string): Promise<{ exists: boolean }>;
  markBillPaid(input: { billId: string; method: string; actorId: string }): Promise<BillRecord>;
  markBillUnpaid(input: { billId: string; actorId: string }): Promise<BillRecord>;
  deleteBill(input: { billId: string; actorId: string }): Promise<void>;
}
