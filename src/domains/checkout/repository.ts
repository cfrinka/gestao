import type { Order, PaymentMethod } from "@/lib/db-types";
import type { CheckoutCartItem, IdempotencyReservation } from "@/domains/checkout/types";

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
  processCheckout(input: {
    items: CheckoutCartItem[];
    payments: PaymentMethod[];
    discount: number;
    clientId?: string;
    clientName?: string;
    payLater: boolean;
    createdById: string;
    createdByRole: string;
  }): Promise<Order>;
  updateClientBalance(clientId: string, amount: number): Promise<void>;
  getOpenCashRegister(userId: string): Promise<{ id: string } | null>;
  updateCashRegisterSales(registerId: string, payments: PaymentMethod[], totalAmount: number): Promise<void>;
}
