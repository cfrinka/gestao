import { randomUUID } from "crypto";
import type { CashRegister, Client, FiadoPayment, Order, Product } from "@/lib/db-types";
import type { ClientsRepository } from "@/domains/clients/repository";
import type { ClientPaymentMethod } from "@/domains/clients/types";

/**
 * Audit trail entry for a debt correction. DemoDataset does not currently have a
 * `debtCorrections` field — see the report for this task for the follow-up needed in
 * demo-store.ts. Until then this is accepted as a plain constructor-provided Map, exactly
 * like every other shared Map this repository touches.
 */
export interface DebtCorrectionRecord {
  id: string;
  clientId: string;
  clientName: string;
  correctionAmount: number;
  previousBalance: number;
  newBalance: number;
  reason: string;
  createdAt: Date;
}

function paymentField(method: ClientPaymentMethod): "totalCash" | "totalPix" | "totalCredit" | "totalDebit" {
  if (method === "DINHEIRO") return "totalCash";
  if (method === "PIX") return "totalPix";
  if (method === "CREDITO") return "totalCredit";
  return "totalDebit";
}

/**
 * In-memory equivalent of FirestoreClientsRepository for demo mode. Constructed fresh per
 * request but always points at the same session-scoped Maps, so state persists across
 * requests within a demo session — including balance changes made by a different in-memory
 * repository (checkout) against the same `clients` Map.
 *
 * Fiado payments and removed order items also touch orders, product stock, and (optionally)
 * the currently open cash register, so this repository needs constructor access to those
 * shared Maps too, not just `clients`.
 *
 * Note: unlike the Firestore implementation, `correctClientDebt` does not verify
 * `adminPassword` against a stored hash — demo mode has no persisted admin-password store,
 * and the admin-password requirement is already enforced by ClientsService before this is
 * called. The parameter is accepted (to satisfy the interface) but ignored.
 */
export class InMemoryClientsRepository implements ClientsRepository {
  constructor(
    private clients: Map<string, Client>,
    private orders: Map<string, Order>,
    private products: Map<string, Product>,
    private cashRegisters: Map<string, CashRegister>,
    private debtCorrections: Map<string, DebtCorrectionRecord>
  ) {}

  private findOpenCashRegister(userId: string): CashRegister | undefined {
    return Array.from(this.cashRegisters.values()).find((r) => r.userId === userId && r.status === "OPEN");
  }

  private getPendingOrders(clientId: string): Order[] {
    return Array.from(this.orders.values())
      .filter((o) => o.clientId === clientId && o.isPaidLater)
      .filter((o) => (typeof o.remainingAmount === "number" ? o.remainingAmount > 0 : true));
  }

  async listClients(): Promise<Client[]> {
    return Array.from(this.clients.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getClient(clientId: string): Promise<Client | null> {
    return this.clients.get(clientId) ?? null;
  }

  async getClientPendingOrders(clientId: string): Promise<Order[]> {
    return this.getPendingOrders(clientId);
  }

  async createClient(data: { name: string; phone?: string; email?: string; notes?: string }): Promise<Client> {
    const now = new Date();
    const client: Client = {
      id: randomUUID(),
      name: data.name,
      phone: data.phone,
      email: data.email,
      notes: data.notes,
      balance: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.clients.set(client.id, client);
    return client;
  }

  async updateClient(
    clientId: string,
    data: { name?: string; phone?: string; email?: string; notes?: string }
  ): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error("Client not found");
    }

    this.clients.set(clientId, {
      ...client,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      updatedAt: new Date(),
    });
  }

  async deleteClient(clientId: string): Promise<void> {
    this.clients.delete(clientId);
  }

  async correctClientDebt(
    clientId: string,
    correctionAmount: number,
    _adminPassword: string,
    reason: string
  ): Promise<void> {
    if (!correctionAmount || correctionAmount === 0) {
      throw new Error("Correction amount must be different from zero");
    }
    if (!reason || reason.trim().length === 0) {
      throw new Error("Reason for correction is required");
    }

    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error("Client not found");
    }

    const previousBalance = client.balance;
    const newBalance = previousBalance + correctionAmount;
    if (correctionAmount > 0 && newBalance < 0) {
      throw new Error("Correction would result in invalid negative balance");
    }

    const now = new Date();

    if (correctionAmount < 0) {
      let remainingToCorrect = Math.abs(correctionAmount);
      const pendingOrders = this.getPendingOrders(clientId)
        .filter((o) => o.isCancelled !== true)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      for (const order of pendingOrders) {
        if (remainingToCorrect <= 0) break;

        const currentRemaining = typeof order.remainingAmount === "number" ? order.remainingAmount : order.totalAmount;
        if (currentRemaining <= 0) continue;

        const correctionToOrder = Math.min(remainingToCorrect, currentRemaining);
        const newRemaining = currentRemaining - correctionToOrder;
        const currentPaid = typeof order.amountPaid === "number" ? order.amountPaid : 0;

        order.amountPaid = currentPaid + correctionToOrder;
        order.remainingAmount = newRemaining;
        order.paymentHistory = [
          ...(order.paymentHistory || []),
          {
            id: `correction_${Date.now()}_${order.id}`,
            amount: correctionToOrder,
            method: "CORRECAO_ADMIN" as unknown as FiadoPayment["method"],
            createdAt: now,
          },
        ];
        if (newRemaining <= 0) order.paidAt = now;

        remainingToCorrect -= correctionToOrder;
      }
    }

    client.balance = newBalance;
    client.updatedAt = now;

    const correctionId = randomUUID();
    this.debtCorrections.set(correctionId, {
      id: correctionId,
      clientId,
      clientName: client.name,
      correctionAmount,
      previousBalance,
      newBalance,
      reason: reason.trim(),
      createdAt: now,
    });
  }

  async applyCascadingFiadoPayment(
    clientId: string,
    amount: number,
    method: ClientPaymentMethod,
    receivedByUserId?: string
  ): Promise<unknown> {
    if (!amount || amount <= 0) {
      throw new Error("Payment amount must be greater than zero");
    }

    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error("Client not found");
    }

    const pendingOrders = this.getPendingOrders(clientId)
      .filter((o) => o.isCancelled !== true)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (pendingOrders.length === 0) {
      throw new Error("No pending fiado orders found");
    }

    let remainingToApply = amount;
    let totalApplied = 0;
    let totalClientBalanceReduction = 0;
    const now = new Date();
    const allocations: Array<{
      orderId: string;
      orderTotalAmount: number;
      remainingBefore: number;
      appliedAmount: number;
      remainingAfter: number;
      isFullyPaid: boolean;
    }> = [];

    for (const order of pendingOrders) {
      if (remainingToApply <= 0) break;

      const currentRemaining = typeof order.remainingAmount === "number" ? order.remainingAmount : order.totalAmount;
      if (currentRemaining <= 0) continue;

      const appliedToOrder = Math.min(remainingToApply, currentRemaining);
      const newRemaining = currentRemaining - appliedToOrder;
      const isFullyPaid = newRemaining <= 0;
      const currentPaid = typeof order.amountPaid === "number" ? order.amountPaid : 0;

      order.amountPaid = currentPaid + appliedToOrder;
      order.remainingAmount = newRemaining;
      order.paymentHistory = [
        ...(order.paymentHistory || []),
        { id: `pay_${Date.now()}_${order.id}`, amount: appliedToOrder, method, createdAt: now },
      ];
      if (isFullyPaid) order.paidAt = now;

      allocations.push({
        orderId: order.id,
        orderTotalAmount: order.totalAmount,
        remainingBefore: currentRemaining,
        appliedAmount: appliedToOrder,
        remainingAfter: newRemaining,
        isFullyPaid,
      });

      totalClientBalanceReduction += appliedToOrder;
      totalApplied += appliedToOrder;
      remainingToApply -= appliedToOrder;
    }

    const overpayment = Math.max(0, remainingToApply);
    client.balance -= totalClientBalanceReduction + overpayment;
    client.updatedAt = now;

    if (receivedByUserId) {
      const register = this.findOpenCashRegister(receivedByUserId);
      if (register) {
        register.totalSales += amount;
        register[paymentField(method)] += amount;
        register.salesCount += allocations.length;
      }
    }

    return { allocations, totalApplied, overpayment };
  }

  async applyFiadoPayment(
    clientId: string,
    orderId: string,
    amount: number,
    method: ClientPaymentMethod,
    receivedByUserId?: string
  ): Promise<void> {
    if (!amount || amount <= 0) {
      throw new Error("Payment amount must be greater than zero");
    }

    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error("Order not found");
    }
    if (!order.isPaidLater) {
      throw new Error("Order is not a FIADO order");
    }
    if (order.clientId !== clientId) {
      throw new Error("Order does not belong to this client");
    }

    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error("Client not found");
    }

    const currentPaid = typeof order.amountPaid === "number" ? order.amountPaid : order.paidAt ? order.totalAmount : 0;
    const currentRemaining =
      typeof order.remainingAmount === "number" ? order.remainingAmount : order.paidAt ? 0 : order.totalAmount;

    if (currentRemaining <= 0) {
      throw new Error("Order is already fully paid");
    }

    const appliedAmount = Math.min(amount, currentRemaining);
    const nextPaid = currentPaid + appliedAmount;
    const nextRemaining = Math.max(0, currentRemaining - appliedAmount);
    const now = new Date();

    order.amountPaid = nextPaid;
    order.remainingAmount = nextRemaining;
    order.paymentHistory = [
      ...(order.paymentHistory || []),
      { id: `pay_${Date.now()}`, amount: appliedAmount, method, createdAt: now },
    ];
    if (nextRemaining === 0) order.paidAt = now;

    client.balance -= appliedAmount;
    client.updatedAt = now;

    if (receivedByUserId) {
      const register = this.findOpenCashRegister(receivedByUserId);
      if (register) {
        register.totalSales += appliedAmount;
        register[paymentField(method)] += appliedAmount;
        register.salesCount += 1;
      }
    }
  }

  async removeFiadoOrderItem(clientId: string, orderId: string, orderItemId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error("Order not found");
    }
    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error("Client not found");
    }
    if (!order.isPaidLater) {
      throw new Error("Order is not a FIADO order");
    }
    if (order.clientId !== clientId) {
      throw new Error("Order does not belong to this client");
    }

    const items = order.items || [];
    const itemIndex = items.findIndex((i) => i.id === orderItemId);
    if (itemIndex < 0) {
      throw new Error("Order item not found");
    }
    const orderItem = items[itemIndex];

    const removedRevenue = Number(orderItem.totalRevenue || orderItem.unitPrice * orderItem.quantity || 0);
    const removedCost = Number(orderItem.totalCost || orderItem.unitCost * orderItem.quantity || 0);

    const currentPaid = typeof order.amountPaid === "number" ? order.amountPaid : order.paidAt ? order.totalAmount : 0;
    const currentRemaining =
      typeof order.remainingAmount === "number" ? order.remainingAmount : order.paidAt ? 0 : order.totalAmount;
    const currentSubtotal =
      typeof order.subtotal === "number" ? order.subtotal : order.totalAmount + Number(order.discount || 0);
    const currentCogs = Number(order.cogsTotal || 0);

    const nextSubtotal = Math.max(0, currentSubtotal - removedRevenue);
    const nextTotal = Math.max(0, Number(order.totalAmount || 0) - removedRevenue);
    const nextCogs = Math.max(0, currentCogs - removedCost);
    const nextPaid = Math.min(currentPaid, nextTotal);
    const nextRemaining = Math.max(0, nextTotal - nextPaid);
    const clientBalanceDelta = nextRemaining - currentRemaining;
    const now = new Date();

    order.subtotal = nextSubtotal;
    order.totalAmount = nextTotal;
    order.cogsTotal = nextCogs;
    order.amountPaid = nextPaid;
    order.remainingAmount = nextRemaining;
    order.paidAt = nextRemaining === 0 ? now : undefined;
    order.items = items.filter((_, idx) => idx !== itemIndex);

    client.balance += clientBalanceDelta;
    client.updatedAt = now;

    const product = this.products.get(orderItem.productId);
    if (product) {
      const safeSize = String(orderItem.size || "").trim();
      if (safeSize) {
        const sizeIndex = product.sizes.findIndex((s) => s.size === safeSize);
        if (sizeIndex >= 0) {
          product.sizes = product.sizes.map((s, idx) =>
            idx === sizeIndex ? { ...s, stock: Number(s.stock || 0) + orderItem.quantity } : s
          );
        } else {
          product.sizes = [...product.sizes, { size: safeSize, stock: orderItem.quantity }];
        }
      }
      product.stock = Number(product.stock || 0) + orderItem.quantity;
      product.updatedAt = now;
    }
  }
}
