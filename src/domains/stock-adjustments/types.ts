export type { IdempotencyReservation } from "@/domains/shared/idempotency";

export interface CreateAdjustmentCommand {
  userId: string;
  userName: string;
  idempotencyKey: string;
  productId: unknown;
  delta: unknown;
  sizeAdjustments: unknown;
  reason: unknown;
}

export interface AdjustmentResult {
  id: string;
  previousStock: number;
  nextStock: number;
  appliedDelta: number;
}

export interface StockAdjustmentRecord {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  previousStock: number;
  nextStock: number;
  delta: number;
  sizeAdjustments: Array<{ size: string; delta: number; before: number; after: number }>;
  reason: string;
  createdById: string;
  createdByName: string;
  createdAt: unknown;
}

export type StockAdjustmentExecutionResult =
  | { status: 200 | 201; body: unknown }
  | { status: 409; body: { error: string } };
