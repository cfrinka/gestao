import type { Order, PaymentMethod } from "@/lib/db-types";

export type { IdempotencyReservation } from "@/domains/shared/idempotency";

export type UserRole = "ADMIN" | "CASHIER" | string;

export interface CheckoutCartItem {
  productId: string;
  size: string;
  quantity: number;
}

export interface CheckoutCommand {
  userId: string;
  userRole: UserRole;
  items: CheckoutCartItem[];
  payments?: PaymentMethod[];
  discount?: number;
  promoDiscount?: number;
  clientId?: string;
  payLater?: boolean;
  idempotencyKey: string;
  subtotal?: number;
}

export interface CheckoutExecutionResult {
  status: 200 | 201 | 409;
  body: Order | { error: string } | unknown;
}
