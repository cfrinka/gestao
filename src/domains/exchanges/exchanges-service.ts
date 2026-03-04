import { HttpError } from "@/lib/api/http-errors";
import type { ExchangesRepository } from "@/domains/exchanges/repository";
import type { CreateExchangeCommand, ExchangeExecutionResult } from "@/domains/exchanges/types";

function toPublicErrorMessage(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (error instanceof Error) return error.message;
  return "Internal server error";
}

export class ExchangesService {
  constructor(private readonly repository: ExchangesRepository) {}

  async list(input: { limit: number; startDate?: Date; endDate?: Date }) {
    return this.repository.listExchanges(input);
  }

  async create(command: CreateExchangeCommand): Promise<ExchangeExecutionResult> {
    const safeIdempotencyKey = (command.idempotencyKey || "").trim();
    if (!safeIdempotencyKey) {
      throw new HttpError(400, "idempotencyKey is required");
    }

    if (command.userRole !== "ADMIN" && command.userRole !== "CASHIER") {
      throw new HttpError(403, "Forbidden");
    }

    if (!Array.isArray(command.items) || command.items.length === 0) {
      throw new HttpError(400, "Adicione ao menos um item na troca");
    }

    const requestHash = JSON.stringify({
      customerName: command.customerName || "",
      notes: command.notes || "",
      paymentMethod: command.paymentMethod || "",
      discountAmount: Number(command.discountAmount || 0),
      items: command.items,
      userId: command.userId,
    });

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
      const openRegisterId = await this.repository.getOpenCashRegisterId(command.userId);

      const exchange = await this.repository.createExchange({
        documentNumber: command.documentNumber,
        customerName: command.customerName,
        notes: command.notes,
        paymentMethod: command.paymentMethod,
        discountAmount: command.discountAmount,
        items: command.items,
        cashRegisterId: openRegisterId,
        createdById: command.userId,
        createdByRole: command.userRole,
        createdByName: command.userDisplayName,
      });

      await this.repository.markIdempotencyCompleted({
        ownerId: command.userId,
        idempotencyKey: safeIdempotencyKey,
        response: exchange,
      });

      return { status: 201, body: exchange };
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
