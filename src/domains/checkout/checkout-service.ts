import { FIADO_BLOCKED, HttpError, IDEMPOTENCY_KEY_REQUIRED_MESSAGE } from "@/lib/api/http-errors";
import { roundMoney } from "@/lib/money";
import { formatPhone, isValidPhone } from "@/lib/phone";
import type { CheckoutIdempotency, CheckoutOrder, CheckoutRepository } from "@/domains/checkout/repository";
import type { CheckoutCommand, CheckoutExecutionResult } from "@/domains/checkout/types";
import { normalizeCartItems, normalizePayments, settlePayments } from "@/domains/checkout/cart-validation";
import { assessFiadoSale } from "@/domains/clients/fiado-credit";

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

    // Optional on a regular sale; when typed it has to be a number the store can reach.
    const typedPhone = payLater ? "" : String(command.customerPhone ?? "").trim();
    if (typedPhone && !isValidPhone(typedPhone)) {
      throw new HttpError(400, "O celular do cliente está incompleto. Confira o DDD e os dígitos, ou deixe em branco.");
    }
    const customerPhone = typedPhone ? formatPhone(typedPhone) : undefined;

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
        ...(customerPhone ? { customerPhone } : {}),
      }),
    };

    const subtotal = roundMoney(Number(command.subtotal || 0));
    // Store promotions (progressive discount, PIX discount, product discounts, etc.)
    // are not subject to the cashier's manual discount limit below.
    const promoDiscount = roundMoney(Number(command.promoDiscount || 0));
    let allowedManualDiscount = roundMoney(requestedDiscount);

    // Fiado rules come before the discount check: a refused fiado sale must not use up the
    // cashier's discount authorization.
    const fiado = payLater
      ? await this.checkFiado(command, idempotency, roundMoney(Math.max(0, subtotal - promoDiscount - allowedManualDiscount)))
      : null;
    if (fiado?.replay) return { status: 200, body: fiado.replay };

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
      ...(fiado?.clientPhone ? { clientPhone: fiado.clientPhone } : {}),
      ...(customerPhone ? { customerPhone } : {}),
      promoDiscount,
      manualDiscount: allowedManualDiscount,
      payLater,
      createdById: command.userId,
      createdByName: command.userName,
      createdByRole: command.userRole,
      idempotency,
    });

    return { status: result.replayed ? 200 : 201, body: result.order };
  }

  /**
   * A fiado sale needs a reachable client (a valid phone, typed now if the record has none) and,
   * past the store's limit or deadline, an administrator: an admin confirms, a cashier needs a
   * grant from the admin password.
   */
  private async checkFiado(
    command: CheckoutCommand,
    idempotency: CheckoutIdempotency,
    saleTotal: number
  ): Promise<{ clientPhone?: string; replay?: CheckoutOrder }> {
    const standing = await this.repository.getFiadoStanding(String(command.clientId));
    if (!standing) throw new HttpError(404, "Cliente não encontrado");

    let clientPhone: string | undefined;
    if (!isValidPhone(standing.phone)) {
      if (!isValidPhone(command.clientPhone)) {
        throw new HttpError(400, `Informe o celular de ${standing.name} com DDD para vender fiado.`);
      }
      clientPhone = formatPhone(command.clientPhone);
    }

    const blocks = command.fiadoPolicy
      ? assessFiadoSale({
          balance: standing.balance,
          oldestOpenAt: standing.oldestOpenAt,
          saleTotal,
          policy: command.fiadoPolicy,
          now: command.now ?? new Date(),
        })
      : [];
    if (blocks.length === 0) return { clientPhone };

    const isAdmin = command.userRole === "ADMIN";
    const authorized = isAdmin
      ? command.fiadoOverride === true
      : await this.repository.consumeFiadoAuthorization(command.userId);
    if (authorized) return { clientPhone };

    // The sale may already have gone through on an attempt whose response was lost: its own
    // amount is what now puts the client past the limit.
    const replay = await this.repository.findCompletedCheckout(idempotency);
    if (replay) return { replay };

    const next = isAdmin ? "Confirme para vender mesmo assim." : "Para vender fiado, peça a senha do administrador.";
    throw new HttpError(403, `${standing.name}: ${blocks.map((block) => block.message).join(" ")} ${next}`, true, FIADO_BLOCKED);
  }
}
