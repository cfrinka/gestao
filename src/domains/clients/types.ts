import type { PaymentMethod } from "@/lib/db-types";

export interface CreateClientCommand {
  name: unknown;
  phone?: unknown;
  email?: unknown;
  notes?: unknown;
}

export interface UpdateClientCommand {
  clientId: string;
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  notes?: unknown;
}

export interface CorrectDebtCommand {
  clientId: string;
  amount: unknown;
  adminPassword: unknown;
  reason: unknown;
}

export interface PayCascadingCommand {
  clientId: string;
  amount: unknown;
  method: unknown;
  receivedByUserId: string;
}

export interface PayOrderCommand {
  clientId: string;
  orderId: string;
  amount: unknown;
  method: unknown;
  receivedByUserId: string;
}

export interface RemoveOrderItemCommand {
  clientId: string;
  orderId: string;
  orderItemId: string;
}

export type ClientPaymentMethod = PaymentMethod["method"];
