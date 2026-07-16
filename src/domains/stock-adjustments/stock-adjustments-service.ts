import { HttpError } from "@/lib/api/http-errors";
import type { StockAdjustmentsRepository } from "@/domains/stock-adjustments/repository";
import type {
  CreateAdjustmentCommand,
  StockAdjustmentExecutionResult,
  StockAdjustmentRecord,
} from "@/domains/stock-adjustments/types";

function toPublicErrorMessage(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (error instanceof Error) return error.message;
  return "Internal server error";
}

export class StockAdjustmentsService {
  constructor(private readonly repository: StockAdjustmentsRepository) {}

  async list(limit: number): Promise<StockAdjustmentRecord[]> {
    return this.repository.listAdjustments(limit);
  }

  async create(command: CreateAdjustmentCommand): Promise<StockAdjustmentExecutionResult> {
    const safeIdempotencyKey = String(command.idempotencyKey || "").trim();
    if (!safeIdempotencyKey) {
      throw new HttpError(400, "idempotencyKey is required");
    }

    const productId = String(command.productId || "").trim();
    const delta = Number(command.delta || 0);
    const reason = String(command.reason || "").trim();
    const sizeAdjustments = Array.isArray(command.sizeAdjustments)
      ? (command.sizeAdjustments as Array<{ size: string; delta: number }>)
      : [];

    if (!productId) throw new HttpError(400, "productId is required");
    if (!Number.isFinite(delta) || (delta === 0 && sizeAdjustments.length === 0)) {
      throw new HttpError(400, "delta must be non-zero");
    }
    if (!reason) throw new HttpError(400, "reason is required");

    const requestHash = JSON.stringify({ productId, delta, sizeAdjustments, reason, userId: command.userId });

    const reservation = await this.repository.reserveIdempotency({
      ownerId: command.userId,
      idempotencyKey: safeIdempotencyKey,
      requestHash,
    });

    if (reservation.type === "conflict") {
      throw new HttpError(409, "Idempotency key reuse with different payload");
    }
    if (reservation.type === "completed") {
      return { status: 200, body: reservation.response };
    }
    if (reservation.type === "in_progress") {
      return { status: 409, body: { error: "Request already being processed" } };
    }

    try {
      const result = await this.repository.createAdjustment({
        productId,
        delta,
        sizeAdjustments,
        reason,
        createdById: command.userId,
        createdByName: command.userName,
      });

      await this.repository.markIdempotencyCompleted({
        ownerId: command.userId,
        idempotencyKey: safeIdempotencyKey,
        response: result,
      });

      return { status: 201, body: result };
    } catch (error) {
      await this.repository.markIdempotencyFailed({
        ownerId: command.userId,
        idempotencyKey: safeIdempotencyKey,
        errorMessage: toPublicErrorMessage(error),
      });
      throw error;
    }
  }
}
