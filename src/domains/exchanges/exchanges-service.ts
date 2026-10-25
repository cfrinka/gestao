import { HttpError, IDEMPOTENCY_CONFLICT_MESSAGE, IDEMPOTENCY_IN_PROGRESS_MESSAGE, IDEMPOTENCY_KEY_REQUIRED_MESSAGE } from "@/lib/api/http-errors";
import type { ExchangesRepository } from "@/domains/exchanges/repository";
import type { CreateExchangeCommand, ExchangeExecutionResult } from "@/domains/exchanges/types";
import { roundMoney } from "@/lib/money";
import { CASHIER_DISCOUNT_CAP } from "@/domains/checkout/checkout-service";

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
      throw new HttpError(400, IDEMPOTENCY_KEY_REQUIRED_MESSAGE);
    }

    if (command.userRole !== "ADMIN" && command.userRole !== "CASHIER") {
      throw new HttpError(403, "Sem permissão");
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

    const requestedDiscountAmount = roundMoney(Number(command.discountAmount || 0));

    // Hash what was asked for: a grant consumed by the first attempt must not make a retry of
    // the same exchange look like a different request.
    const requestHash = JSON.stringify({
      customerName: command.customerName || "",
      notes: command.notes || "",
      paymentMethod: command.paymentMethod || "",
      discountAmount: requestedDiscountAmount,
      items: command.items,
      userId: command.userId,
    });

    const reservation = await this.repository.reserveIdempotency({
      ownerId: command.userId,
      idempotencyKey: safeIdempotencyKey,
      requestHash,
    });

    if (reservation.type === "conflict") {
      throw new HttpError(409, IDEMPOTENCY_CONFLICT_MESSAGE);
    }

    if (reservation.type === "completed") {
      return { status: 200, body: reservation.response };
    }

    if (reservation.type === "in_progress") {
      return { status: 409, body: { error: IDEMPOTENCY_IN_PROGRESS_MESSAGE } };
    }

    try {
      // Same rule as checkout: a cashier's discount above 10% needs the admin password, and
      // without it the exchange is refused instead of saved with a smaller discount than quoted.
      if (command.userRole === "CASHIER") {
        const maxDiscount = roundMoney(estimatedGrossDifference * CASHIER_DISCOUNT_CAP);
        if (requestedDiscountAmount > maxDiscount) {
          const isAuthorized = await this.repository.consumeDiscountAuthorization(command.userId);
          if (!isAuthorized) {
            throw new HttpError(403, "Desconto acima de 10% precisa da senha do administrador.");
          }
        }
      }
      const allowedDiscountAmount = requestedDiscountAmount;

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
