import {
  createFixedBills,
  createInstallments,
  createOneTimeBill,
  deleteBill,
  getBill,
  listBills,
  markBillPaid,
  markBillUnpaid,
} from "@/domains/bills/bills-db";
import { markIdempotencyCompleted, markIdempotencyFailed, reserveIdempotency } from "@/domains/shared/idempotency";
import type { BillsRepository } from "@/domains/bills/repository";
import type { BillPaymentMethod, BillRecord, IdempotencyReservation, ListBillsQuery } from "@/domains/bills/types";

const SCOPE = "bills-create";

export class FirestoreBillsRepository implements BillsRepository {
  async reserveIdempotency(input: {
    ownerId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<IdempotencyReservation> {
    return reserveIdempotency(SCOPE, input.ownerId, input.idempotencyKey, input.requestHash);
  }

  async markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }): Promise<void> {
    await markIdempotencyCompleted(SCOPE, input.ownerId, input.idempotencyKey, input.response);
  }

  async markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }): Promise<void> {
    await markIdempotencyFailed(SCOPE, input.ownerId, input.idempotencyKey, input.errorMessage);
  }

  async createFixedBills(params: {
    name: string;
    amount: number;
    dayOfMonth: number;
    startMonth?: string;
    monthsAhead: number;
  }) {
    return createFixedBills(params);
  }

  async createOneTimeBill(params: { name: string; amount: number; dueDate: string }) {
    return createOneTimeBill(params);
  }

  async createInstallments(params: {
    name: string;
    amount: number;
    firstDueDate: string;
    installmentsCount: number;
    intervalMonths: number;
  }) {
    return createInstallments(params);
  }

  async listBills(query: ListBillsQuery): Promise<BillRecord[]> {
    return listBills(query);
  }

  async getBill(billId: string): Promise<{ exists: boolean }> {
    return getBill(billId);
  }

  async markBillPaid(input: { billId: string; method: string; actorId: string }): Promise<BillRecord> {
    return markBillPaid({ billId: input.billId, method: input.method as BillPaymentMethod, actorId: input.actorId });
  }

  async markBillUnpaid(input: { billId: string; actorId: string }): Promise<BillRecord> {
    return markBillUnpaid(input);
  }

  async deleteBill(input: { billId: string; actorId: string }): Promise<void> {
    return deleteBill(input);
  }
}
