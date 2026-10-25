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
    if (!result) throw new HttpError(404, "Cliente não encontrado");
    return result;
  }

  async create(command: CreateClientCommand): Promise<Client> {
    const name = typeof command.name === "string" ? command.name.trim() : "";
    if (!name) throw new HttpError(400, "Informe o nome do cliente");

    return this.repository.createClient({
      name,
      phone: typeof command.phone === "string" ? command.phone : undefined,
      email: typeof command.email === "string" ? command.email : undefined,
      notes: typeof command.notes === "string" ? command.notes : undefined,
    });
  }

  async update(command: UpdateClientCommand): Promise<Client> {
    const existing = await this.repository.getClient(command.clientId);
    if (!existing) throw new HttpError(404, "Cliente não encontrado");

    await this.repository.updateClient(command.clientId, {
      name: typeof command.name === "string" ? command.name : undefined,
      phone: typeof command.phone === "string" ? command.phone : undefined,
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
    if (client.balance !== 0) {
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

    const paymentResult = await this.repository.applyCascadingFiadoPayment(
      command.clientId,
      finalAmount,
      toPaymentMethod(command.method),
      command.receivedByUserId,
      command.receivedByUserName
    );

    const result = await this.withPendingOrders(command.clientId);
    if (!result) throw new HttpError(404, "Cliente não encontrado");
    return { ...result, paymentResult };
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
    await this.repository.applyFiadoPayment(
      command.clientId,
      command.orderId,
      finalAmount,
      toPaymentMethod(command.method),
      command.receivedByUserId,
      command.receivedByUserName
    );

    const result = await this.withPendingOrders(command.clientId);
    if (!result) throw new HttpError(404, "Cliente não encontrado");
    return result;
  }

  async removeOrderItem(command: RemoveOrderItemCommand): Promise<Client & { pendingOrders: Order[] }> {
    await this.repository.removeFiadoOrderItem(command.clientId, command.orderId, command.orderItemId);
    const result = await this.withPendingOrders(command.clientId);
    if (!result) throw new HttpError(404, "Cliente não encontrado");
    return result;
  }
}
