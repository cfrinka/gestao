import type { Client, Order } from "@/lib/db-types";
import type { ClientPaymentMethod } from "@/domains/clients/types";
import type { IdempotencyReservation } from "@/domains/shared/idempotency";

export interface ClientsRepository {
  listClients(): Promise<Client[]>;
  getClient(clientId: string): Promise<Client | null>;
  getClientPendingOrders(clientId: string): Promise<Order[]>;
  createClient(data: { name: string; phone?: string; email?: string; notes?: string }): Promise<Client>;
  updateClient(clientId: string, data: { name?: string; phone?: string; email?: string; notes?: string }): Promise<void>;
  deleteClient(clientId: string): Promise<void>;
  correctClientDebt(clientId: string, amount: number, adminPassword: string, reason: string): Promise<void>;
  applyCascadingFiadoPayment(
    clientId: string,
    amount: number,
    method: ClientPaymentMethod,
    receivedByUserId?: string,
    receivedByUserName?: string
  ): Promise<unknown>;
  applyFiadoPayment(
    clientId: string,
    orderId: string,
    amount: number,
    method: ClientPaymentMethod,
    receivedByUserId?: string,
    receivedByUserName?: string
  ): Promise<void>;
  removeFiadoOrderItem(clientId: string, orderId: string, orderItemId: string): Promise<void>;
  reserveIdempotency(input: { ownerId: string; idempotencyKey: string; requestHash: string }): Promise<IdempotencyReservation>;
  markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }): Promise<void>;
  markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }): Promise<void>;
}
