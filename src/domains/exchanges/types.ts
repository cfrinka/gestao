import type { ExchangeRecord } from "@/lib/db-types";

export type ExchangePaymentMethod = "cash" | "pix" | "credit" | "debit";

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
  items: ExchangeItemCommand[];
  idempotencyKey: string;
}

export type IdempotencyReservation =
  | { type: "new" }
  | { type: "completed"; response: unknown }
  | { type: "in_progress" }
  | { type: "conflict" };

export interface ExchangeExecutionResult {
  status: 200 | 201 | 409;
  body: ExchangeRecord | { error: string } | unknown;
}
