import { HttpError, IDEMPOTENCY_KEY_REQUIRED_MESSAGE } from "@/lib/api/http-errors";
import { roundMoney } from "@/lib/money";
import type { CheckoutRepository } from "@/domains/checkout/repository";
import type { CheckoutCommand, CheckoutExecutionResult } from "@/domains/checkout/types";
import { normalizeCartItems, normalizePayments, settlePayments } from "@/domains/checkout/cart-validation";

export const CASHIER_DISCOUNT_CAP = 0.1;

export class CheckoutService {
  constructor(private readonly repository: CheckoutRepository) {}

  async execute(command: CheckoutCommand): Promise<CheckoutExecutionResult> {
    const safeIdempotencyKey = (command.idempotencyKey || "").trim();
    if (!safeIdempotencyKey) {
      throw new HttpError(400, IDEMPOTENCY_KEY_REQUIRED_MESSAGE);
    }

    const items = normalizeCartItems(command.items);

    const canUsePayLater = command.userRole === "ADMIN" || command.userRole === "CASHIER";
    const payLater = Boolean(command.payLater);

    if (payLater && !canUsePayLater) {
      throw new HttpError(403, "Seu perfil não pode vender fiado");
    }

    if (payLater && !command.clientId) {
      throw new HttpError(400, "Selecione o cliente da venda fiado");
    }

    const requestedDiscount = Number(command.discount || 0);
    if (!Number.isFinite(requestedDiscount) || requestedDiscount < 0) {
      throw new HttpError(400, "Desconto inválido");
    }

    const receivedPayments = payLater ? [] : normalizePayments(command.payments);
    if (!payLater && receivedPayments.length === 0) {
      throw new HttpError(400, "Informe a forma de pagamento");
    }

    // The hash covers what the cashier asked for, not what the server derives from it (a
    // consumed discount grant, the change): a retry of the same sale must hash the same, or a
    // sale whose response was lost on a bad connection could never be recovered.
    const idempotency = {
      ownerId: command.userId,
      key: safeIdempotencyKey,
      requestHash: JSON.stringify({
        items,
        payments: receivedPayments,
        discount: roundMoney(requestedDiscount),
        clientId: payLater ? command.clientId : undefined,
        payLater,
        userId: command.userId,
      }),
    };

    const subtotal = roundMoney(Number(command.subtotal || 0));
    // Store promotions (progressive discount, PIX discount, product discounts, etc.)
    // are not subject to the cashier's manual discount limit below.
    const promoDiscount = roundMoney(Number(command.promoDiscount || 0));
    let allowedManualDiscount = roundMoney(requestedDiscount);

    if (command.userRole === "CASHIER") {
      // Cashiers can apply up to 10% discount, unless a server-verified admin
      // authorization grant is on file for this user (see /api/admin/verify-password).
      // Above the cap without a grant the sale is refused rather than quietly charged a
      // different total than the one the cashier quoted.
      const maxDiscount = roundMoney(subtotal * CASHIER_DISCOUNT_CAP);
      if (allowedManualDiscount > maxDiscount) {
        const isAuthorized = await this.repository.consumeDiscountAuthorization(command.userId);
        if (!isAuthorized) {
          // The grant may have been used by this very sale on an attempt whose response was lost.
          const replay = await this.repository.findCompletedCheckout(idempotency);
          if (replay) return { status: 200, body: replay };
          throw new HttpError(403, "Desconto acima de 10% precisa da senha do administrador.");
        }
      }
    } else if (command.userRole !== "ADMIN") {
      allowedManualDiscount = 0;
    }

    const discount = roundMoney(promoDiscount + allowedManualDiscount);
    const expectedTotal = roundMoney(Math.max(0, subtotal - discount));
    const { payments, change } = payLater
      ? { payments: [], change: 0 }
      : settlePayments(receivedPayments, expectedTotal);

    // A single transaction checks the key, register, client and stock and writes everything,
    // including the completed key — nothing is left half-done to reconcile afterwards.
    const result = await this.repository.processCheckout({
      items,
      payments,
      change,
      discount,
      expectedTotal,
      clientId: payLater ? command.clientId : undefined,
      payLater,
      createdById: command.userId,
      createdByName: command.userName,
      createdByRole: command.userRole,
      idempotency,
    });

    return { status: result.replayed ? 200 : 201, body: result.order };
  }
}
