import type { Order, PaymentMethod } from "@/lib/db-types";
import { adminDb } from "@/lib/firebase-admin";
import { getClient, updateClientBalance } from "@/domains/clients/clients-db";
import { getOpenCashRegister, updateCashRegisterSales } from "@/domains/cash-register/cash-register-db";
import { processCheckout } from "@/domains/checkout/checkout-db";
import type { CheckoutRepository } from "@/domains/checkout/repository";
import type { CheckoutCartItem, IdempotencyReservation } from "@/domains/checkout/types";

type IdempotencyDoc = {
  requestHash?: string;
  status?: "PROCESSING" | "COMPLETED" | "FAILED";
  response?: unknown;
  errorMessage?: string;
  retries?: number;
};

export class FirestoreCheckoutRepository implements CheckoutRepository {
  private idempotencyRef(ownerId: string, idempotencyKey: string) {
    return adminDb.collection("idempotencyKeys").doc(`checkout:${ownerId}:${idempotencyKey}`);
  }

  async getClientNameById(clientId: string): Promise<string | null> {
    const client = await getClient(clientId);
    return client?.name || null;
  }

  async reserveIdempotency(input: {
    ownerId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<IdempotencyReservation> {
    const ref = this.idempotencyRef(input.ownerId, input.idempotencyKey);

    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);

      if (!snap.exists) {
        tx.create(ref, {
          scope: "checkout",
          ownerId: input.ownerId,
          key: input.idempotencyKey,
          requestHash: input.requestHash,
          status: "PROCESSING",
          retries: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return { type: "new" };
      }

      const data = snap.data() as IdempotencyDoc;
      if (String(data.requestHash || "") !== input.requestHash) {
        return { type: "conflict" };
      }

      if (data.status === "COMPLETED") {
        return { type: "completed", response: data.response };
      }

      if (data.status === "PROCESSING") {
        return { type: "in_progress" };
      }

      tx.update(ref, {
        status: "PROCESSING",
        errorMessage: null,
        retries: Number(data.retries || 0) + 1,
        updatedAt: new Date(),
      });
      return { type: "new" };
    });
  }

  async markIdempotencyCompleted(input: {
    ownerId: string;
    idempotencyKey: string;
    response: unknown;
  }): Promise<void> {
    const ref = this.idempotencyRef(input.ownerId, input.idempotencyKey);
    await ref.set(
      {
        status: "COMPLETED",
        completedAt: new Date(),
        updatedAt: new Date(),
        response: JSON.parse(JSON.stringify(input.response)),
      },
      { merge: true }
    );
  }

  async markIdempotencyFailed(input: {
    ownerId: string;
    idempotencyKey: string;
    errorMessage: string;
  }): Promise<void> {
    const ref = this.idempotencyRef(input.ownerId, input.idempotencyKey);
    await ref.set(
      {
        status: "FAILED",
        errorMessage: input.errorMessage,
        failedAt: new Date(),
        updatedAt: new Date(),
      },
      { merge: true }
    );
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
}
