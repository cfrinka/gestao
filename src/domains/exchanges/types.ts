import type { ExchangeRecord } from "@/lib/db-types";

export type { IdempotencyReservation } from "@/domains/shared/idempotency";

export type ExchangePaymentMethod = "cash" | "pix" | "credit" | "debit";

/** When the exchange leaves money in the customer's favour: handed back in cash, or not refunded. */
export type ExchangeRefundMode = "cash" | "none";

export interface ExchangeItemCommand {
  productId: string;
  size?: string;
  quantity: number;
  direction: "IN" | "OUT";
}

export interface CreateExchangeCommand {
  userId: string;
  userRole: string;
  userDisplayName: string;
  documentNumber?: string;
  customerName?: string;
  notes?: string;
  paymentMethod?: ExchangePaymentMethod;
  discountAmount?: number;
  refundMode?: unknown;
  items: ExchangeItemCommand[];
  idempotencyKey: string;
}

export interface ExchangeExecutionResult {
  status: 200 | 201 | 409;
  body: ExchangeRecord | { error: string } | unknown;
}
