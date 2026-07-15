import type { ExchangeRecord } from "@/lib/db-types";
import type { ExchangeItemCommand, ExchangePaymentMethod, IdempotencyReservation } from "@/domains/exchanges/types";

export interface ExchangesRepository {
  listExchanges(input: { limit: number; startDate?: Date; endDate?: Date }): Promise<ExchangeRecord[]>;
  reserveIdempotency(input: {
    ownerId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<IdempotencyReservation>;
  markIdempotencyCompleted(input: {
    ownerId: string;
    idempotencyKey: string;
    response: unknown;
  }): Promise<void>;
  markIdempotencyFailed(input: {
    ownerId: string;
    idempotencyKey: string;
    errorMessage: string;
  }): Promise<void>;
  getOpenCashRegisterId(userId: string): Promise<string | undefined>;
  getProductSalePrices(productIds: string[]): Promise<Map<string, number>>;
  /** Consumes a server-issued discount-override grant for this user, if one is live. Single-use. */
  consumeDiscountAuthorization(userId: string): Promise<boolean>;
  createExchange(input: {
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
  }): Promise<ExchangeRecord>;
}
