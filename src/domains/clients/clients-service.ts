import {
  HttpError,
  IDEMPOTENCY_CONFLICT_MESSAGE,
  IDEMPOTENCY_IN_PROGRESS_MESSAGE,
  IDEMPOTENCY_KEY_REQUIRED_MESSAGE,
} from "@/lib/api/http-errors";
import type { ClientsRepository } from "@/domains/clients/repository";
import type {
  ClientPaymentMethod,
  CorrectDebtCommand,
  CreateClientCommand,
  PayCascadingCommand,
  PayOrderCommand,
  RemoveOrderItemCommand,
  UpdateClientCommand,
} from "@/domains/clients/types";
import type { Client, Order } from "@/lib/db-types";
import { isZeroMoney } from "@/lib/money";
import { formatPhone, isValidPhone } from "@/lib/phone";

const ALLOWED_METHODS = ["DINHEIRO", "DEBITO", "CREDITO", "PIX"] as const;

function toPaymentMethod(value: unknown): ClientPaymentMethod {
  return (ALLOWED_METHODS as readonly string[]).includes(String(value)) ? (value as ClientPaymentMethod) : "DINHEIRO";
}

/**
 * Every client can buy fiado, so every client needs a number the store can reach (and remind on
 * WhatsApp). Stored in one format: "(11) 98765-4321".
 */
function requiredPhone(value: unknown): string {
  if (!isValidPhone(value)) {
    throw new HttpError(400, "Informe o celular do cliente com DDD, por exemplo (11) 98765-4321");
  }
  return formatPhone(value);
}

export class ClientsService {
  constructor(private readonly repository: ClientsRepository) {}

  /**
   * A fiado receipt moves money into the register and out of the client's balance, so a double
   * tap (or a retry after a dropped response) must not record it twice. The browser sends one
   * key per receipt; a repeat with the same key returns the first result instead of paying again.
   */
  private async runOnce<T>(ownerId: string, rawKey: unknown, payload: unknown, work: () => Promise<T>): Promise<T> {
    const idempotencyKey = typeof rawKey === "string" ? rawKey.trim() : "";
    if (!idempotencyKey) {
      throw new HttpError(400, IDEMPOTENCY_KEY_REQUIRED_MESSAGE);
    }

    const reservation = await this.repository.reserveIdempotency({
      ownerId,
      idempotencyKey,
      requestHash: JSON.stringify(payload),
    });

    if (reservation.type === "conflict") throw new HttpError(409, IDEMPOTENCY_CONFLICT_MESSAGE);
    if (reservation.type === "in_progress") throw new HttpError(409, IDEMPOTENCY_IN_PROGRESS_MESSAGE);
    if (reservation.type === "completed") return reservation.response as T;

    try {
      const result = await work();
      await this.repository.markIdempotencyCompleted({ ownerId, idempotencyKey, response: result });
      return result;
    } catch (error) {
      await this.repository.markIdempotencyFailed({
        ownerId,
        idempotencyKey,
        errorMessage: error instanceof Error ? error.message : "erro",
      });
      throw error;
    }
  }

  async list(): Promise<Client[]> {
    return this.repository.listClients();
  }

  private async withPendingOrders(clientId: string): Promise<(Client & { pendingOrders: Order[] }) | null> {
    const client = await this.repository.getClient(clientId);
    if (!client) return null;
    const pendingOrders = await this.repository.getClientPendingOrders(clientId);
    return { ...client, pendingOrders };
  }

  async get(clientId: string): Promise<Client & { pendingOrders: Order[] }> {
    const result = await this.withPendingOrders(clientId);
    if (!result) throw new HttpError(404, "Cliente não encontrado");
    return result;
  }

  async create(command: CreateClientCommand): Promise<Client> {
    const name = typeof command.name === "string" ? command.name.trim() : "";
    if (!name) throw new HttpError(400, "Informe o nome do cliente");

    return this.repository.createClient({
      name,
      phone: requiredPhone(command.phone),
      email: typeof command.email === "string" ? command.email : undefined,
      notes: typeof command.notes === "string" ? command.notes : undefined,
    });
  }

  async update(command: UpdateClientCommand): Promise<Client> {
    const existing = await this.repository.getClient(command.clientId);
    if (!existing) throw new HttpError(404, "Cliente não encontrado");

    await this.repository.updateClient(command.clientId, {
      name: typeof command.name === "string" ? command.name : undefined,
      phone: command.phone === undefined ? undefined : requiredPhone(command.phone),
      email: typeof command.email === "string" ? command.email : undefined,
      notes: typeof command.notes === "string" ? command.notes : undefined,
    });

    const updated = await this.repository.getClient(command.clientId);
    if (!updated) throw new HttpError(404, "Cliente não encontrado");
    return updated;
  }

  async remove(clientId: string): Promise<void> {
    const client = await this.repository.getClient(clientId);
    if (!client) throw new HttpError(404, "Cliente não encontrado");
    if (!isZeroMoney(client.balance)) {
      throw new HttpError(400, "Não é possível excluir um cliente com saldo em aberto");
    }
    await this.repository.deleteClient(clientId);
  }

  async correctDebt(command: CorrectDebtCommand): Promise<Client & { pendingOrders: Order[] }> {
    const client = await this.repository.getClient(command.clientId);
    if (!client) throw new HttpError(404, "Cliente não encontrado");

    const adminPassword = typeof command.adminPassword === "string" ? command.adminPassword : "";
    const reason = typeof command.reason === "string" ? command.reason : "";
    if (!adminPassword || !reason) {
      throw new HttpError(400, "Valor de correção inválido");
    }

    const correctionAmount = typeof command.amount === "number" ? command.amount : parseFloat(String(command.amount));
    if (!Number.isFinite(correctionAmount) || correctionAmount === 0) {
      throw new HttpError(400, "Valor de correção inválido");
    }

    // Expected failures (wrong password, closed month, …) arrive as HttpError with their own
    // status; anything else propagates and is reported as a generic server error.
    await this.repository.correctClientDebt(command.clientId, correctionAmount, adminPassword, reason);

    const result = await this.withPendingOrders(command.clientId);
    if (!result) throw new HttpError(404, "Cliente não encontrado");
    return result;
  }

  async payCascading(
    command: PayCascadingCommand
  ): Promise<Client & { pendingOrders: Order[]; paymentResult: unknown }> {
    const client = await this.repository.getClient(command.clientId);
    if (!client) throw new HttpError(404, "Cliente não encontrado");

    const paymentAmount = typeof command.amount === "number" ? command.amount : parseFloat(String(command.amount));
    const finalAmount = Number.isFinite(paymentAmount) && paymentAmount > 0 ? paymentAmount : 0;
    if (finalAmount <= 0) {
      throw new HttpError(400, "Valor de pagamento inválido");
    }

    const method = toPaymentMethod(command.method);
    const payload = { action: "pay_cascading", clientId: command.clientId, amount: finalAmount, method };

    return this.runOnce(command.receivedByUserId, command.idempotencyKey, payload, async () => {
      const paymentResult = await this.repository.applyCascadingFiadoPayment(
        command.clientId,
        finalAmount,
        method,
        command.receivedByUserId,
        command.receivedByUserName
      );

      const result = await this.withPendingOrders(command.clientId);
      if (!result) throw new HttpError(404, "Cliente não encontrado");
      return { ...result, paymentResult };
    });
  }

  async payOrder(command: PayOrderCommand): Promise<Client & { pendingOrders: Order[] }> {
    const client = await this.repository.getClient(command.clientId);
    if (!client) throw new HttpError(404, "Cliente não encontrado");

    const pendingOrders = await this.repository.getClientPendingOrders(command.clientId);
    const order = pendingOrders.find((o) => o.id === command.orderId);
    if (!order) {
      throw new HttpError(404, "Venda não encontrada ou já quitada");
    }

    const remaining = typeof order.remainingAmount === "number" ? order.remainingAmount : order.totalAmount;
    const paymentAmount = typeof command.amount === "number" ? command.amount : parseFloat(String(command.amount));
    const finalAmount = Number.isFinite(paymentAmount) && paymentAmount > 0 ? paymentAmount : remaining;

    // Any failure here (validation, a concurrent payment already settling this order, a
    // closed financial month) is surfaced as a real error — it must NOT be silently
    // papered over by force-marking the order paid and blindly debiting the client's full
    // original total, which would double-count an already-applied payment or bypass the
    // closed-month guard entirely.
    const method = toPaymentMethod(command.method);
    const payload = { action: "pay_order", clientId: command.clientId, orderId: command.orderId, amount: finalAmount, method };

    return this.runOnce(command.receivedByUserId, command.idempotencyKey, payload, async () => {
      await this.repository.applyFiadoPayment(
        command.clientId,
        command.orderId,
        finalAmount,
        method,
        command.receivedByUserId,
        command.receivedByUserName
      );

      const result = await this.withPendingOrders(command.clientId);
      if (!result) throw new HttpError(404, "Cliente não encontrado");
      return result;
    });
  }

  async removeOrderItem(command: RemoveOrderItemCommand): Promise<Client & { pendingOrders: Order[] }> {
    await this.repository.removeFiadoOrderItem(command.clientId, command.orderId, command.orderItemId);
    const result = await this.withPendingOrders(command.clientId);
    if (!result) throw new HttpError(404, "Cliente não encontrado");
    return result;
  }
}
