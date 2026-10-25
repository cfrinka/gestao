import type { Order } from "@/lib/db-types";
import { getClient } from "@/domains/clients/clients-db";
import { getOpenCashRegister } from "@/domains/cash-register/cash-register-db";
import { processCheckout } from "@/domains/checkout/checkout-db";
import { consumeDiscountAuthorization } from "@/lib/discount-authorization";
import { markIdempotencyCompleted, markIdempotencyFailed, reserveIdempotency } from "@/domains/shared/idempotency";
import type { CheckoutRepository, ProcessCheckoutInput } from "@/domains/checkout/repository";
import type { IdempotencyReservation } from "@/domains/checkout/types";

const SCOPE = "checkout";

export class FirestoreCheckoutRepository implements CheckoutRepository {
  async getClientNameById(clientId: string): Promise<string | null> {
    const client = await getClient(clientId);
    return client?.name || null;
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

  async processCheckout(input: ProcessCheckoutInput): Promise<Order> {
    return processCheckout(input);
  }

  async getOpenCashRegisterId(userId: string): Promise<string | null> {
    const register = await getOpenCashRegister(userId);
    return register?.id ?? null;
  }

  async consumeDiscountAuthorization(userId: string): Promise<boolean> {
    return consumeDiscountAuthorization(userId);
  }
}
