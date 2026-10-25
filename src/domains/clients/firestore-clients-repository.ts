import {
  applyCascadingFiadoPayment,
  applyFiadoPayment,
  correctClientDebt,
  createClient,
  deleteClient,
  getClient,
  getClientPendingOrders,
  getClients,
  removeFiadoOrderItem,
  updateClient,
} from "@/domains/clients/clients-db";
import type { ClientsRepository } from "@/domains/clients/repository";
import type { ClientPaymentMethod } from "@/domains/clients/types";
import type { Client, Order } from "@/lib/db-types";
import {
  markIdempotencyCompleted,
  markIdempotencyFailed,
  reserveIdempotency,
  type IdempotencyReservation,
} from "@/domains/shared/idempotency";

const FIADO_PAYMENT_SCOPE = "fiado-payment";

export class FirestoreClientsRepository implements ClientsRepository {
  async listClients(): Promise<Client[]> {
    return getClients();
  }

  async getClient(clientId: string): Promise<Client | null> {
    return getClient(clientId);
  }

  async getClientPendingOrders(clientId: string): Promise<Order[]> {
    return getClientPendingOrders(clientId);
  }

  async createClient(data: { name: string; phone?: string; email?: string; notes?: string }): Promise<Client> {
    return createClient(data);
  }

  async updateClient(
    clientId: string,
    data: { name?: string; phone?: string; email?: string; notes?: string }
  ): Promise<void> {
    return updateClient(clientId, data);
  }

  async deleteClient(clientId: string): Promise<void> {
    return deleteClient(clientId);
  }

  async correctClientDebt(clientId: string, amount: number, adminPassword: string, reason: string): Promise<void> {
    return correctClientDebt(clientId, amount, adminPassword, reason);
  }

  async applyCascadingFiadoPayment(
    clientId: string,
    amount: number,
    method: ClientPaymentMethod,
    receivedByUserId?: string,
    receivedByUserName?: string
  ): Promise<unknown> {
    return applyCascadingFiadoPayment(clientId, amount, method, receivedByUserId, receivedByUserName);
  }

  async applyFiadoPayment(
    clientId: string,
    orderId: string,
    amount: number,
    method: ClientPaymentMethod,
    receivedByUserId?: string,
    receivedByUserName?: string
  ): Promise<void> {
    return applyFiadoPayment(clientId, orderId, amount, method, receivedByUserId, receivedByUserName);
  }

  async removeFiadoOrderItem(clientId: string, orderId: string, orderItemId: string): Promise<void> {
    return removeFiadoOrderItem(clientId, orderId, orderItemId);
  }

  async reserveIdempotency(input: { ownerId: string; idempotencyKey: string; requestHash: string }): Promise<IdempotencyReservation> {
    return reserveIdempotency(FIADO_PAYMENT_SCOPE, input.ownerId, input.idempotencyKey, input.requestHash);
  }

  async markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }): Promise<void> {
    await markIdempotencyCompleted(FIADO_PAYMENT_SCOPE, input.ownerId, input.idempotencyKey, input.response);
  }

  async markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }): Promise<void> {
    await markIdempotencyFailed(FIADO_PAYMENT_SCOPE, input.ownerId, input.idempotencyKey, input.errorMessage);
  }
}
