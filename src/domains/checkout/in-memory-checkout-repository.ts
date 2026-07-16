import { randomUUID } from "crypto";
import type { CashRegister, Client, Order, OrderItem, PaymentMethod, Product } from "@/lib/db-types";
import type { CheckoutRepository } from "@/domains/checkout/repository";
import type { CheckoutCartItem, IdempotencyReservation } from "@/domains/checkout/types";

export type CheckoutIdempotencyEntry = {
  requestHash: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  response?: unknown;
};

/**
 * In-memory equivalent of FirestoreCheckoutRepository for demo mode. Faithfully replicates the
 * stock-decrement + order-item math from checkout-db.ts's processCheckout (unit cost/revenue/
 * profit per line, cogsTotal, discount clamp) against the caller's shared Maps, so a sale here is
 * visible to the products screen (stock), the cash-register screen (sales totals), and the
 * orders/sales-history screen (the new Order) in the same demo session.
 *
 * Simplifications vs. the real implementation:
 * - No Firestore transaction/retry semantics — demo sessions are single-user, so the plain
 *   read-validate-then-write below can't race the way concurrent Firestore checkouts could.
 * - No financialClosures month-lock check (the demo dataset has no financial-closures concept).
 * - No financialMovements (SALE_REVENUE/COGS) documents are written — the demo dataset doesn't
 *   model that collection; cogsTotal is still computed and returned on the Order for the UI.
 * - consumeDiscountAuthorization always returns false: the admin password-grant flow that lets a
 *   cashier exceed the 10% discount cap is disabled entirely in demo mode.
 */
export class InMemoryCheckoutRepository implements CheckoutRepository {
  constructor(
    private readonly products: Map<string, Product>,
    private readonly productSkuIndex: Map<string, string>,
    private readonly orders: Map<string, Order>,
    private readonly cashRegisters: Map<string, CashRegister>,
    private readonly clients: Map<string, Client>,
    private readonly idempotency: Map<string, CheckoutIdempotencyEntry>,
    private readonly discountAuthorizations: Set<string> = new Set()
  ) {}

  async getClientNameById(clientId: string): Promise<string | null> {
    return this.clients.get(clientId)?.name ?? null;
  }

  async reserveIdempotency(input: {
    ownerId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<IdempotencyReservation> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotency.get(key);

    if (!existing) {
      this.idempotency.set(key, { requestHash: input.requestHash, status: "PROCESSING" });
      return { type: "new" };
    }
    if (existing.requestHash !== input.requestHash) {
      return { type: "conflict" };
    }
    if (existing.status === "COMPLETED") {
      return { type: "completed", response: existing.response };
    }
    if (existing.status === "PROCESSING") {
      return { type: "in_progress" };
    }

    existing.status = "PROCESSING";
    return { type: "new" };
  }

  async markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }): Promise<void> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotency.get(key);
    if (existing) {
      existing.status = "COMPLETED";
      existing.response = input.response;
    }
  }

  async markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }): Promise<void> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotency.get(key);
    if (existing) existing.status = "FAILED";
  }

  async processCheckout(input: {
    items: CheckoutCartItem[];
    payments: PaymentMethod[];
    discount: number;
    clientId?: string;
    clientName?: string;
    payLater: boolean;
    createdById: string;
    createdByRole: string;
  }): Promise<Order> {
    if (input.createdByRole !== "ADMIN" && input.createdByRole !== "CASHIER") {
      throw new Error("Role not allowed to process checkout");
    }
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new Error("No items in cart");
    }

    // Read + clone every distinct product first (mirrors the transaction's read-then-write:
    // validate everything against working copies before committing any mutation).
    const productsById = new Map<string, Product>();
    for (const item of input.items) {
      if (productsById.has(item.productId)) continue;
      const product = this.products.get(item.productId);
      if (!product) {
        throw new Error(`Product ${item.productId} not found`);
      }
      productsById.set(item.productId, { ...product, sizes: product.sizes.map((s) => ({ ...s })) });
    }

    let subtotal = 0;
    let cogsTotal = 0;
    const orderItems: Omit<OrderItem, "id">[] = [];

    for (const item of input.items) {
      const product = productsById.get(item.productId)!;
      const quantity = Number(item.quantity);

      if (product.sizes.length > 0) {
        const sizeEntry = product.sizes.find((s) => s.size === item.size);
        if (!sizeEntry || sizeEntry.stock < quantity) {
          throw new Error(
            `Insufficient stock for ${product.name} size ${item.size}. Available: ${sizeEntry?.stock || 0}`
          );
        }
        sizeEntry.stock -= quantity;
      } else {
        if (product.stock < quantity) {
          throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stock}`);
        }
        product.stock -= quantity;
      }

      const unitCost = product.costPrice;
      const unitPrice = product.salePrice;
      const totalCost = unitCost * quantity;
      const totalRevenue = unitPrice * quantity;
      const profit = totalRevenue - totalCost;

      subtotal += totalRevenue;
      cogsTotal += totalCost;

      orderItems.push({
        orderId: "",
        productId: product.id,
        productName: product.name,
        ...(product.ownerId ? { ownerId: product.ownerId } : {}),
        size: item.size,
        quantity,
        unitCostAtSale: unitCost,
        unitCost,
        unitPrice,
        totalCost,
        totalRevenue,
        profit,
      });
    }

    const totalAmount = Math.max(0, subtotal - input.discount);
    const orderId = randomUUID();
    const now = new Date();

    // Commit stock changes only after every item validated successfully.
    for (const [productId, product] of Array.from(productsById.entries())) {
      if (product.sizes.length > 0) {
        product.stock = product.sizes.reduce((sum, s) => sum + Number(s.stock || 0), 0);
      }
      product.updatedAt = now;
      this.products.set(productId, product);
    }

    const order: Order = {
      id: orderId,
      subtotal,
      discount: input.discount,
      totalAmount,
      cogsTotal,
      payments: input.payments,
      createdById: input.createdById,
      createdAt: now,
      items: orderItems.map((item, index) => ({ ...item, id: `item-${index}`, orderId })),
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.clientName ? { clientName: input.clientName } : {}),
      ...(input.payLater
        ? { isPaidLater: true, amountPaid: 0, remainingAmount: totalAmount, paymentHistory: [] }
        : {}),
    };

    this.orders.set(orderId, order);
    return order;
  }

  async updateClientBalance(clientId: string, amount: number): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.clients.set(clientId, { ...client, balance: Number(client.balance || 0) + amount, updatedAt: new Date() });
  }

  async getOpenCashRegister(userId: string): Promise<{ id: string } | null> {
    for (const register of Array.from(this.cashRegisters.values())) {
      if (register.userId === userId && register.status === "OPEN") return { id: register.id };
    }
    return null;
  }

  async updateCashRegisterSales(registerId: string, payments: PaymentMethod[], totalAmount: number): Promise<void> {
    const register = this.cashRegisters.get(registerId);
    if (!register) return;

    const cashAmount = payments.find((p) => p.method === "DINHEIRO")?.amount || 0;
    const debitAmount = payments.find((p) => p.method === "DEBITO")?.amount || 0;
    const creditAmount = payments.find((p) => p.method === "CREDITO")?.amount || 0;
    const pixAmount = payments.find((p) => p.method === "PIX")?.amount || 0;

    this.cashRegisters.set(registerId, {
      ...register,
      totalSales: register.totalSales + totalAmount,
      totalCash: register.totalCash + cashAmount,
      totalDebit: register.totalDebit + debitAmount,
      totalCredit: register.totalCredit + creditAmount,
      totalPix: register.totalPix + pixAmount,
      salesCount: register.salesCount + 1,
    });
  }

  /**
   * The admin password-grant flow that populates this is disabled entirely in demo mode (see
   * the guarded admin/set-password and admin/verify-password routes), so `discountAuthorizations`
   * is always empty in practice — this still checks it for symmetry with exchanges' equivalent.
   */
  async consumeDiscountAuthorization(userId: string): Promise<boolean> {
    if (this.discountAuthorizations.has(userId)) {
      this.discountAuthorizations.delete(userId);
      return true;
    }
    return false;
  }
}
