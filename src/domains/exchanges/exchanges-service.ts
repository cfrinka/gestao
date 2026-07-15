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

    // Estimate the exchange's owed difference from real product prices, to decide whether the
    // requested discount needs the same cashier cap / admin authorization checkout enforces.
    // The transaction in createExchange re-derives the authoritative difference from its own
    // reads and never lets the final discount exceed it, regardless of this estimate.
    const productIds = command.items.map((item) => item.productId);
    const salePrices = await this.repository.getProductSalePrices(productIds);
    let estimatedOut = 0;
    let estimatedIn = 0;
    for (const item of command.items) {
      const value = (salePrices.get(item.productId) || 0) * Number(item.quantity || 0);
      if (item.direction === "OUT") estimatedOut += value;
      else estimatedIn += value;
    }
    const estimatedGrossDifference = Math.max(0, estimatedOut - estimatedIn);

    const requestedDiscountAmount = Number(command.discountAmount || 0);
    let allowedDiscountAmount = requestedDiscountAmount;

    if (command.userRole === "CASHIER") {
      const maxDiscount = estimatedGrossDifference * 0.10;
      if (requestedDiscountAmount > maxDiscount) {
        const isAuthorized = await this.repository.consumeDiscountAuthorization(command.userId);
        allowedDiscountAmount = isAuthorized ? requestedDiscountAmount : maxDiscount;
      }
    }

    const requestHash = JSON.stringify({
      customerName: command.customerName || "",
      notes: command.notes || "",
      paymentMethod: command.paymentMethod || "",
      discountAmount: allowedDiscountAmount,
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
        discountAmount: allowedDiscountAmount,
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
