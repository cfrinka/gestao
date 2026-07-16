import { createAdjustment, listAdjustments } from "@/domains/stock-adjustments/stock-adjustments-db";
import { markIdempotencyCompleted, markIdempotencyFailed, reserveIdempotency } from "@/domains/shared/idempotency";
import type { StockAdjustmentsRepository } from "@/domains/stock-adjustments/repository";
import type { AdjustmentResult, IdempotencyReservation, StockAdjustmentRecord } from "@/domains/stock-adjustments/types";

const SCOPE = "stock-adjustments";

export class FirestoreStockAdjustmentsRepository implements StockAdjustmentsRepository {
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

  async createAdjustment(input: {
    productId: string;
    delta: number;
    sizeAdjustments: Array<{ size: string; delta: number }>;
    reason: string;
    createdById: string;
    createdByName: string;
  }): Promise<AdjustmentResult> {
    return createAdjustment(input);
  }

  async listAdjustments(limit: number): Promise<StockAdjustmentRecord[]> {
    return listAdjustments(limit);
  }
}
