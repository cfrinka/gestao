import { HttpError } from "@/lib/api/http-errors";
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

const ALLOWED_METHODS = ["DINHEIRO", "DEBITO", "CREDITO", "PIX"] as const;

function toPaymentMethod(value: unknown): ClientPaymentMethod {
  return (ALLOWED_METHODS as readonly string[]).includes(String(value)) ? (value as ClientPaymentMethod) : "DINHEIRO";
}

export class ClientsService {
  constructor(private readonly repository: ClientsRepository) {}

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
    if (!result) throw new HttpError(404, "Client not found");
    return result;
  }

  async create(command: CreateClientCommand): Promise<Client> {
    const name = typeof command.name === "string" ? command.name.trim() : "";
    if (!name) throw new HttpError(400, "Name is required");

    return this.repository.createClient({
      name,
      phone: typeof command.phone === "string" ? command.phone : undefined,
      email: typeof command.email === "string" ? command.email : undefined,
      notes: typeof command.notes === "string" ? command.notes : undefined,
    });
  }

  async update(command: UpdateClientCommand): Promise<Client> {
    const existing = await this.repository.getClient(command.clientId);
    if (!existing) throw new HttpError(404, "Client not found");

    await this.repository.updateClient(command.clientId, {
      name: typeof command.name === "string" ? command.name : undefined,
      phone: typeof command.phone === "string" ? command.phone : undefined,
      email: typeof command.email === "string" ? command.email : undefined,
      notes: typeof command.notes === "string" ? command.notes : undefined,
    });

    const updated = await this.repository.getClient(command.clientId);
    if (!updated) throw new HttpError(404, "Client not found");
    return updated;
  }

  async remove(clientId: string): Promise<void> {
    const client = await this.repository.getClient(clientId);
    if (!client) throw new HttpError(404, "Client not found");
    if (client.balance !== 0) {
      throw new HttpError(400, "Cannot delete client with pending balance");
    }
    await this.repository.deleteClient(clientId);
  }

  async correctDebt(command: CorrectDebtCommand): Promise<Client & { pendingOrders: Order[] }> {
    const client = await this.repository.getClient(command.clientId);
    if (!client) throw new HttpError(404, "Client not found");

    const adminPassword = typeof command.adminPassword === "string" ? command.adminPassword : "";
    const reason = typeof command.reason === "string" ? command.reason : "";
    if (!adminPassword || !reason) {
      throw new HttpError(400, "Invalid correction amount");
    }

    const correctionAmount = typeof command.amount === "number" ? command.amount : parseFloat(String(command.amount));
    if (!Number.isFinite(correctionAmount) || correctionAmount === 0) {
      throw new HttpError(400, "Invalid correction amount");
    }

    try {
      await this.repository.correctClientDebt(command.clientId, correctionAmount, adminPassword, reason);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Invalid admin password")) {
        throw new HttpError(403, "Senha de administrador inválida");
      }
      throw new HttpError(400, error instanceof Error ? error.message : "Erro ao corrigir débito");
    }

    const result = await this.withPendingOrders(command.clientId);
    if (!result) throw new HttpError(404, "Client not found");
    return result;
  }

  async payCascading(
    command: PayCascadingCommand
  ): Promise<Client & { pendingOrders: Order[]; paymentResult: unknown }> {
    const client = await this.repository.getClient(command.clientId);
    if (!client) throw new HttpError(404, "Client not found");

    const paymentAmount = typeof command.amount === "number" ? command.amount : parseFloat(String(command.amount));
    const finalAmount = Number.isFinite(paymentAmount) && paymentAmount > 0 ? paymentAmount : 0;
    if (finalAmount <= 0) {
      throw new HttpError(400, "Invalid payment amount");
    }

    let paymentResult: unknown;
    try {
      paymentResult = await this.repository.applyCascadingFiadoPayment(
        command.clientId,
        finalAmount,
        toPaymentMethod(command.method),
        command.receivedByUserId
      );
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Erro ao registrar pagamento");
    }

    const result = await this.withPendingOrders(command.clientId);
    if (!result) throw new HttpError(404, "Client not found");
    return { ...result, paymentResult };
  }

  async payOrder(command: PayOrderCommand): Promise<Client & { pendingOrders: Order[] }> {
    const client = await this.repository.getClient(command.clientId);
    if (!client) throw new HttpError(404, "Client not found");

    const pendingOrders = await this.repository.getClientPendingOrders(command.clientId);
    const order = pendingOrders.find((o) => o.id === command.orderId);
    if (!order) {
      throw new HttpError(404, "Order not found or already paid");
    }

    const remaining = typeof order.remainingAmount === "number" ? order.remainingAmount : order.totalAmount;
    const paymentAmount = typeof command.amount === "number" ? command.amount : parseFloat(String(command.amount));
    const finalAmount = Number.isFinite(paymentAmount) && paymentAmount > 0 ? paymentAmount : remaining;

    // Any failure here (validation, a concurrent payment already settling this order, a
    // closed financial month) is surfaced as a real error — it must NOT be silently
    // papered over by force-marking the order paid and blindly debiting the client's full
    // original total, which would double-count an already-applied payment or bypass the
    // closed-month guard entirely.
    try {
      await this.repository.applyFiadoPayment(
        command.clientId,
        command.orderId,
        finalAmount,
        toPaymentMethod(command.method),
        command.receivedByUserId
      );
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Erro ao registrar pagamento");
    }

    const result = await this.withPendingOrders(command.clientId);
    if (!result) throw new HttpError(404, "Client not found");
    return result;
  }

  async removeOrderItem(command: RemoveOrderItemCommand): Promise<Client & { pendingOrders: Order[] }> {
    await this.repository.removeFiadoOrderItem(command.clientId, command.orderId, command.orderItemId);
    const result = await this.withPendingOrders(command.clientId);
    if (!result) throw new HttpError(404, "Client not found");
    return result;
  }
}
