import type { AdjustmentResult, IdempotencyReservation, StockAdjustmentRecord } from "@/domains/stock-adjustments/types";

export interface StockAdjustmentsRepository {
  reserveIdempotency(input: { ownerId: string; idempotencyKey: string; requestHash: string }): Promise<IdempotencyReservation>;
  markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }): Promise<void>;
  markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }): Promise<void>;

  createAdjustment(input: {
    productId: string;
    delta: number;
    sizeAdjustments: Array<{ size: string; delta: number }>;
    reason: string;
    createdById: string;
    createdByName: string;
  }): Promise<AdjustmentResult>;

  listAdjustments(limit: number): Promise<StockAdjustmentRecord[]>;
}
