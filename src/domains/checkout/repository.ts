import type { Order, PaymentMethod } from "@/lib/db-types";
import type { CheckoutCartItem } from "@/domains/checkout/types";

/** One attempted sale: the same key and payload always resolve to the same order. */
export interface CheckoutIdempotency {
  ownerId: string;
  key: string;
  requestHash: string;
}

export interface ProcessCheckoutInput {
  items: CheckoutCartItem[];
  /** What the store kept, per method — change already taken out of cash. */
  payments: PaymentMethod[];
  change: number;
  discount: number;
  /** Total the payments were settled against; the transaction refuses the sale if prices moved. */
  expectedTotal: number;
  clientId?: string;
  /** Saved on the client with the sale, when the client had no valid phone on file. */
  clientPhone?: string;
  payLater: boolean;
  createdById: string;
  createdByName: string;
  createdByRole: string;
  idempotency: CheckoutIdempotency;
}

/**
 * The saved order, plus what the POS needs to refresh itself without another request: the new
 * stock of the products sold and the register's new totals.
 */
export type CheckoutOrder = Order & {
  updatedStock?: Array<{ productId: string; stock: number; sizes: Array<{ size: string; stock: number }> }>;
  register?: Record<string, unknown> | null;
};

export interface CheckoutResult {
  /** True when this key had already completed: the stored order is returned and nothing is written. */
  replayed: boolean;
  order: CheckoutOrder;
}

/** What the fiado rules look at before a sale on credit. */
export interface FiadoStanding {
  name: string;
  balance: number;
  phone: string;
  oldestOpenAt: Date | null;
}

export interface CheckoutRepository {
  /**
   * In one transaction: checks the idempotency key, the cashier's open register, the client and
   * the stock; creates the order, decrements stock, adds the sale to the register (or the fiado
   * amount to the client) and records the key as completed. Either all of it happens or none.
   */
  processCheckout(input: ProcessCheckoutInput): Promise<CheckoutResult>;
  /** The stored order for a key that already completed with this same payload, if any. */
  findCompletedCheckout(idempotency: CheckoutIdempotency): Promise<CheckoutOrder | null>;
  /** Consumes a server-issued discount-override grant for this user, if one is live. Single-use. */
  consumeDiscountAuthorization(userId: string): Promise<boolean>;
  /** The client's balance, phone and oldest open fiado purchase; null when the client does not exist. */
  getFiadoStanding(clientId: string): Promise<FiadoStanding | null>;
  /** Consumes a grant to sell fiado past the store's rules, if one is live. Single-use. */
  consumeFiadoAuthorization(userId: string): Promise<boolean>;
}
