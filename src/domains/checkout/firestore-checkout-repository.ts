import type { Order, PaymentMethod } from "@/lib/db-types";
import { getClient, updateClientBalance } from "@/domains/clients/clients-db";
import { getOpenCashRegister, updateCashRegisterSales } from "@/domains/cash-register/cash-register-db";
import { processCheckout } from "@/domains/checkout/checkout-db";
import { consumeDiscountAuthorization } from "@/lib/discount-authorization";
import { markIdempotencyCompleted, markIdempotencyFailed, reserveIdempotency } from "@/domains/shared/idempotency";
import type { CheckoutRepository } from "@/domains/checkout/repository";
import type { CheckoutCartItem, IdempotencyReservation } from "@/domains/checkout/types";

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

  async processCheckout(input: {
    items: CheckoutCartItem[];
    payments: PaymentMethod[];
    discount: number;
    clientId?: string;
    clientName?: string;
    payLater: boolean;
    createdById: string;
    createdByRole: string;
  }): Promise<Order> {
    return processCheckout(
      input.items,
      input.payments,
      input.discount,
      input.clientId,
      input.clientName,
      input.payLater,
      input.createdById,
      input.createdByRole
    );
  }

  async updateClientBalance(clientId: string, amount: number): Promise<void> {
    await updateClientBalance(clientId, amount);
  }

  async getOpenCashRegister(userId: string): Promise<{ id: string } | null> {
    const register = await getOpenCashRegister(userId);
    if (!register) return null;
    return { id: register.id };
  }

  async updateCashRegisterSales(registerId: string, payments: PaymentMethod[], totalAmount: number): Promise<void> {
    await updateCashRegisterSales(registerId, payments, totalAmount);
  }

  async consumeDiscountAuthorization(userId: string): Promise<boolean> {
    return consumeDiscountAuthorization(userId);
  }
}
