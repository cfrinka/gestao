import type { Order, PaymentMethod } from "@/lib/db-types";
import type { FiadoPolicy } from "@/domains/clients/fiado-credit";

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
  userName: string;
  items: CheckoutCartItem[];
  payments?: PaymentMethod[];
  discount?: number;
  promoDiscount?: number;
  clientId?: string;
  payLater?: boolean;
  idempotencyKey: string;
  subtotal?: number;
  /** Fiado only: the client's mobile, typed at the counter when the record has none. */
  clientPhone?: unknown;
  /** Fiado only: an administrator saw the warnings and sells anyway. */
  fiadoOverride?: boolean;
  /** The store's fiado rules; none means fiado is never refused. */
  fiadoPolicy?: FiadoPolicy;
  now?: Date;
}

export interface CheckoutExecutionResult {
  status: 200 | 201 | 409;
  body: Order | { error: string } | unknown;
}
