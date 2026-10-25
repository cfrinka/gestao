import type { Order, PaymentMethod } from "@/lib/db-types";
import type { CheckoutCartItem, IdempotencyReservation } from "@/domains/checkout/types";

export interface ProcessCheckoutInput {
  items: CheckoutCartItem[];
  /** What the store kept, per method — change already taken out of cash. */
  payments: PaymentMethod[];
  change: number;
  discount: number;
  /** Total the payments were settled against; the transaction refuses the sale if prices moved. */
  expectedTotal: number;
  clientId?: string;
  clientName?: string;
  payLater: boolean;
  cashRegisterId: string;
  createdById: string;
  createdByName: string;
  createdByRole: string;
}

export interface CheckoutRepository {
  getClientNameById(clientId: string): Promise<string | null>;
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
  /**
   * Creates the order and, in the same transaction, decrements stock, adds the sale to the
   * cash register (or the fiado amount to the client's balance). Either all of it happens or none.
   */
  processCheckout(input: ProcessCheckoutInput): Promise<Order>;
  getOpenCashRegisterId(userId: string): Promise<string | null>;
  /** Consumes a server-issued discount-override grant for this user, if one is live. Single-use. */
  consumeDiscountAuthorization(userId: string): Promise<boolean>;
}
