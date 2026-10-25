import type { PaymentMethod } from "@/lib/db-types";
import { HttpError } from "@/lib/api/http-errors";
import { formatBRL, roundMoney } from "@/lib/money";
import type { CheckoutCartItem } from "@/domains/checkout/types";

export const PAYMENT_METHODS = ["DINHEIRO", "DEBITO", "CREDITO", "PIX"] as const;

const MAX_QUANTITY_PER_LINE = 999;

/**
 * The browser is not trusted with quantities: a negative or fractional quantity would add
 * stock back and subtract revenue inside the checkout transaction.
 */
export function normalizeCartItems(raw: unknown): CheckoutCartItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError(400, "Adicione ao menos um produto à venda");
  }

  return raw.map((entry) => {
    const item = (entry || {}) as Record<string, unknown>;
    const productId = typeof item.productId === "string" ? item.productId.trim() : "";
    const size = typeof item.size === "string" ? item.size.trim() : "";
    const quantity = Number(item.quantity);

    if (!productId) {
      throw new HttpError(400, "Produto inválido na venda");
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_LINE) {
      throw new HttpError(400, "Quantidade inválida na venda");
    }

    return { productId, size, quantity };
  });
}

/** Validates methods and amounts, merges repeated methods and rounds to cents. Zero lines are dropped. */
export function normalizePayments(raw: unknown): PaymentMethod[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new HttpError(400, "Formas de pagamento inválidas");
  }

  const totals = new Map<PaymentMethod["method"], number>();
  for (const entry of raw) {
    const payment = (entry || {}) as Record<string, unknown>;
    const method = String(payment.method || "") as PaymentMethod["method"];
    const amount = Number(payment.amount);

    if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
      throw new HttpError(400, "Forma de pagamento inválida");
    }
    if (!Number.isFinite(amount) || amount < 0) {
      throw new HttpError(400, "Valor de pagamento inválido");
    }

    totals.set(method, (totals.get(method) || 0) + amount);
  }

  return PAYMENT_METHODS.filter((method) => totals.has(method))
    .map((method) => ({ method, amount: roundMoney(totals.get(method) || 0) }))
    .filter((payment) => payment.amount > 0);
}

/**
 * Turns what the customer handed over into what the store actually kept. Paying R$ 100 in
 * cash for an R$ 80 sale records R$ 80 of cash and R$ 20 of change — the register's expected
 * cash must not count money that left the drawer as troco.
 *
 * A cent of difference is tolerated either way: PIX discounts are computed from the rounded
 * PIX amount, so a PIX-only payment can land one cent off the rounded total.
 */
export function settlePayments(
  payments: PaymentMethod[],
  total: number
): { payments: PaymentMethod[]; change: number } {
  const roundedTotal = roundMoney(total);
  const paid = roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0));

  if (paid < roundedTotal - 0.01) {
    throw new HttpError(400, `Pagamento menor que o total. Falta ${formatBRL(roundedTotal - paid)}.`);
  }

  const excess = roundMoney(paid - roundedTotal);
  if (excess <= 0.01) {
    return { payments, change: 0 };
  }

  const cash = payments.find((payment) => payment.method === "DINHEIRO");
  if (!cash || cash.amount < excess) {
    throw new HttpError(
      400,
      "O valor pago passou do total. Só dá para devolver troco do pagamento em dinheiro — ajuste os valores."
    );
  }

  const netPayments = payments
    .map((payment) =>
      payment.method === "DINHEIRO" ? { ...payment, amount: roundMoney(payment.amount - excess) } : payment
    )
    .filter((payment) => payment.amount > 0);

  return { payments: netPayments, change: excess };
}
