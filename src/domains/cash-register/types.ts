export type { IdempotencyReservation } from "@/domains/shared/idempotency";

export interface AdjustmentCommand {
  userId: string;
  idempotencyKey: string;
  type: "SUPPLY" | "WITHDRAWAL";
  amount: unknown;
  note?: unknown;
  actorId: string;
  actorRole: string;
}

export type AdjustmentExecutionResult =
  | { status: 200 | 201; body: unknown }
  | { status: 409; body: { error: string } };
