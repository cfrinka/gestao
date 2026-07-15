import { adminDb } from "@/lib/firebase-admin";
import type { ExchangeRecord } from "@/lib/db-types";
import { getOpenCashRegister } from "@/domains/cash-register/cash-register-db";
import { createExchange, getExchanges } from "@/domains/exchanges/exchanges-db";
import { consumeDiscountAuthorization } from "@/lib/discount-authorization";
import { markIdempotencyCompleted, markIdempotencyFailed, reserveIdempotency } from "@/domains/shared/idempotency";
import type { ExchangesRepository } from "@/domains/exchanges/repository";
import type { ExchangeItemCommand, ExchangePaymentMethod, IdempotencyReservation } from "@/domains/exchanges/types";

const SCOPE = "exchange";

export class FirestoreExchangesRepository implements ExchangesRepository {
  async listExchanges(input: { limit: number; startDate?: Date; endDate?: Date }): Promise<ExchangeRecord[]> {
    return getExchanges(input.limit, input.startDate, input.endDate);
  }

  async reserveIdempotency(input: {
    ownerId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<IdempotencyReservation> {
    return reserveIdempotency(SCOPE, input.ownerId, input.idempotencyKey, input.requestHash);
  }

  async markIdempotencyCompleted(input: {
    ownerId: string;
    idempotencyKey: string;
    response: unknown;
  }): Promise<void> {
    await markIdempotencyCompleted(SCOPE, input.ownerId, input.idempotencyKey, input.response);
  }

  async markIdempotencyFailed(input: {
    ownerId: string;
    idempotencyKey: string;
    errorMessage: string;
  }): Promise<void> {
    await markIdempotencyFailed(SCOPE, input.ownerId, input.idempotencyKey, input.errorMessage);
  }

  async getOpenCashRegisterId(userId: string): Promise<string | undefined> {
    const register = await getOpenCashRegister(userId);
    return register?.id;
  }

  async getProductSalePrices(productIds: string[]): Promise<Map<string, number>> {
    const uniqueIds = Array.from(new Set(productIds));
    const prices = new Map<string, number>();
    await Promise.all(
      uniqueIds.map(async (id) => {
        const snap = await adminDb.collection("products").doc(id).get();
        prices.set(id, Number(snap.data()?.salePrice || 0));
      })
    );
    return prices;
  }

  async consumeDiscountAuthorization(userId: string): Promise<boolean> {
    return consumeDiscountAuthorization(userId);
  }

  async createExchange(input: {
    documentNumber?: string;
    customerName?: string;
    notes?: string;
    paymentMethod?: ExchangePaymentMethod;
    discountAmount?: number;
    items: ExchangeItemCommand[];
    cashRegisterId?: string;
    createdById: string;
    createdByRole: string;
    createdByName: string;
  }): Promise<ExchangeRecord> {
    return createExchange({
      documentNumber: input.documentNumber,
      customerName: input.customerName,
      notes: input.notes,
      paymentMethod: input.paymentMethod,
      discountAmount: input.discountAmount,
      items: input.items,
      cashRegisterId: input.cashRegisterId,
      createdById: input.createdById,
      createdByRole: input.createdByRole,
      createdByName: input.createdByName,
    });
  }
}
