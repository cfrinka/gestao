/**
 * What a financial movement does to the money the store actually has.
 *
 * The movement log mixes two views of the business: the accounting view (a sale's revenue and
 * the cost of the goods it sold) and the cash view (money in the till or the bank). Summing every
 * movement by its direction counted a fiado sale as cash on the day of the sale and again when
 * the customer paid, and counted goods twice on the way out — once when bought (STOCK_PURCHASE)
 * and again as the cost of each sale (COGS). Cash flow is only what really came in or went out.
 */
export interface CashMovementLike {
  type?: string;
  direction?: "IN" | "OUT" | string;
  amount?: number;
  metadata?: { isPaidLater?: boolean } | Record<string, unknown>;
}

export function cashEffect(movement: CashMovementLike): { cashIn: number; cashOut: number } {
  const amount = Number(movement.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return { cashIn: 0, cashOut: 0 };

  switch (movement.type) {
    case "SALE_REVENUE":
      // A fiado sale brings no money until the customer pays (FIADO_PAYMENT).
      return (movement.metadata as { isPaidLater?: boolean } | undefined)?.isPaidLater
        ? { cashIn: 0, cashOut: 0 }
        : { cashIn: amount, cashOut: 0 };
    case "FIADO_PAYMENT":
    case "EXCHANGE_DIFFERENCE":
      return { cashIn: amount, cashOut: 0 };
    case "STOCK_PURCHASE":
    case "OPERATING_EXPENSE":
    case "EXCHANGE_REFUND":
      return { cashIn: 0, cashOut: amount };
    case "COGS":
      // The cost of what was sold: an accounting figure. The cash left when the stock was bought.
      return { cashIn: 0, cashOut: 0 };
    default:
      return movement.direction === "IN"
        ? { cashIn: amount, cashOut: 0 }
        : movement.direction === "OUT"
          ? { cashIn: 0, cashOut: amount }
          : { cashIn: 0, cashOut: 0 };
  }
}
