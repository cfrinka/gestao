import { adminDb } from "@/lib/firebase-admin";
import type { ExchangeRecord } from "@/lib/db-types";
import { getOpenCashRegister } from "@/domains/cash-register/cash-register-db";
import { createExchange, getExchanges } from "@/domains/exchanges/exchanges-db";
import type { ExchangesRepository } from "@/domains/exchanges/repository";
import type { ExchangeItemCommand, ExchangePaymentMethod, IdempotencyReservation } from "@/domains/exchanges/types";

type IdempotencyDoc = {
  requestHash?: string;
  status?: "PROCESSING" | "COMPLETED" | "FAILED";
  response?: unknown;
  retries?: number;
};

export class FirestoreExchangesRepository implements ExchangesRepository {
  private idempotencyRef(ownerId: string, idempotencyKey: string) {
    return adminDb.collection("idempotencyKeys").doc(`exchange:${ownerId}:${idempotencyKey}`);
  }

  async listExchanges(input: { limit: number; startDate?: Date; endDate?: Date }): Promise<ExchangeRecord[]> {
    return getExchanges(input.limit, input.startDate, input.endDate);
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
          scope: "exchange",
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

  async getOpenCashRegisterId(userId: string): Promise<string | undefined> {
    const register = await getOpenCashRegister(userId);
    return register?.id;
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
