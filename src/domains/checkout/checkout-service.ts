import { HttpError } from "@/lib/api/http-errors";
import type { CheckoutRepository } from "@/domains/checkout/repository";
import type { CheckoutCommand, CheckoutExecutionResult } from "@/domains/checkout/types";

function toPublicErrorMessage(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (error instanceof Error) return error.message;
  return "Internal server error";
}

export class CheckoutService {
  constructor(private readonly repository: CheckoutRepository) {}

  async execute(command: CheckoutCommand): Promise<CheckoutExecutionResult> {
    const safeIdempotencyKey = (command.idempotencyKey || "").trim();
    if (!safeIdempotencyKey) {
      throw new HttpError(400, "idempotencyKey is required");
    }

    if (!Array.isArray(command.items) || command.items.length === 0) {
      throw new HttpError(400, "No items in cart");
    }

    const canUseAdvancedFeatures = command.userRole === "ADMIN";
    const payLater = Boolean(command.payLater);

    if (payLater && !canUseAdvancedFeatures) {
      throw new HttpError(403, "You don't have permission to use pay later");
    }

    if (payLater && !command.clientId) {
      throw new HttpError(400, "clientId is required for pay later");
    }

    const allowedDiscount = canUseAdvancedFeatures ? Number(command.discount || 0) : 0;
    const normalizedPayments = payLater ? [] : command.payments || [];

    let clientName: string | undefined;
    if (payLater && command.clientId) {
      const fetchedClientName = await this.repository.getClientNameById(command.clientId);
      if (!fetchedClientName) {
        throw new HttpError(404, "Client not found");
      }
      clientName = fetchedClientName;
    }

    const requestHash = JSON.stringify({
      items: command.items,
      payments: normalizedPayments,
      discount: allowedDiscount,
      clientId: payLater ? command.clientId : undefined,
      payLater,
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
      const order = await this.repository.processCheckout({
        items: command.items,
        payments: normalizedPayments,
        discount: allowedDiscount,
        clientId: payLater ? command.clientId : undefined,
        clientName,
        payLater,
        createdById: command.userId,
        createdByRole: command.userRole,
      });

      if (payLater && command.clientId) {
        await this.repository.updateClientBalance(command.clientId, order.totalAmount);
      }

      if (!payLater && normalizedPayments.length > 0) {
        const cashRegister = await this.repository.getOpenCashRegister(command.userId);
        if (cashRegister) {
          await this.repository.updateCashRegisterSales(cashRegister.id, normalizedPayments, order.totalAmount);
        }
      }

      await this.repository.markIdempotencyCompleted({
        ownerId: command.userId,
        idempotencyKey: safeIdempotencyKey,
        response: order,
      });

      return { status: 201, body: order };
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
