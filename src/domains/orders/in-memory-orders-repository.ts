import type { CashRegister, Order, PaymentMethod, Product } from "@/lib/db-types";
import type { OrdersRepository } from "@/domains/orders/repository";

type PositivePayment = { method: PaymentMethod["method"]; amount: number };

function normalizePositivePayments(
  payments: Array<{ method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"; amount: number }>
): PositivePayment[] {
  return payments
    .map((payment) => ({ method: payment.method, amount: Number(payment.amount || 0) }))
    .filter((payment) => Number.isFinite(payment.amount) && payment.amount > 0);
}

function paymentAmountByMethod(payments: PositivePayment[]): Record<PaymentMethod["method"], number> {
  return {
    DINHEIRO: payments.find((p) => p.method === "DINHEIRO")?.amount || 0,
    DEBITO: payments.find((p) => p.method === "DEBITO")?.amount || 0,
    CREDITO: payments.find((p) => p.method === "CREDITO")?.amount || 0,
    PIX: payments.find((p) => p.method === "PIX")?.amount || 0,
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * In-memory equivalent of FirestoreOrdersRepository for demo mode. Reads/writes the caller's
 * shared `orders` Map — the same one InMemoryCheckoutRepository creates orders in — plus
 * `products` (to restore stock on cancellation, mirroring orders-db.ts's cancelOrder) and
 * `cashRegisters` (to keep an open register's running totals consistent when an order under it
 * is cancelled or edited, mirroring orders-db.ts's findMatchingCashRegister + totals adjustment).
 *
 * Simplifications vs. the real implementation: no financialMovements (SALE_REVENUE/COGS) or
 * financialAuditLogs documents are written, and no financialClosures month-lock check is
 * performed — the demo dataset doesn't model those collections.
 */
export class InMemoryOrdersRepository implements OrdersRepository {
  constructor(
    private readonly orders: Map<string, Order>,
    private readonly products: Map<string, Product>,
    private readonly cashRegisters: Map<string, CashRegister>
  ) {}

  async getOrders(startDate?: Date, endDate?: Date): Promise<Order[]> {
    let list = Array.from(this.orders.values());
    if (startDate && endDate) {
      const start = startDate.getTime();
      const end = endDate.getTime();
      list = list.filter((order) => {
        const createdAt = toDate(order.createdAt).getTime();
        return createdAt >= start && createdAt <= end;
      });
    }
    return list.sort((a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime());
  }

  private findMatchingCashRegister(orderCreatedAt: Date): CashRegister | undefined {
    const candidates = Array.from(this.cashRegisters.values())
      .filter((register) => register.openedAt.getTime() <= orderCreatedAt.getTime())
      .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
    return candidates.find((register) => !register.closedAt || register.closedAt.getTime() >= orderCreatedAt.getTime());
  }

  async cancelOrder(input: {
    orderId: string;
    actorId: string;
    actorRole: string;
    reason?: string;
  }): Promise<Order> {
    if (input.actorRole !== "ADMIN") {
      throw new Error("Only admins can cancel sales");
    }

    const order = this.orders.get(input.orderId);
    if (!order) {
      throw new Error("Order not found");
    }
    if (order.isCancelled) {
      throw new Error("Order is already cancelled");
    }
    if (order.isPaidLater) {
      throw new Error("Fiado sales cannot be cancelled in this screen");
    }

    const safeReason = String(input.reason || "").trim();
    const items = order.items || [];

    // Restore stock for each item.
    for (const item of items) {
      const product = this.products.get(item.productId);
      if (!product) continue;

      const quantity = Number(item.quantity || 0);
      const size = String(item.size || "").trim();

      if (size && product.sizes.length > 0) {
        const sizeIndex = product.sizes.findIndex((s) => s.size === size);
        if (sizeIndex >= 0) {
          const updatedSizes = product.sizes.map((s, idx) =>
            idx === sizeIndex ? { ...s, stock: Number(s.stock || 0) + quantity } : s
          );
          const newStock = updatedSizes.reduce((sum, s) => sum + Number(s.stock || 0), 0);
          this.products.set(item.productId, { ...product, stock: newStock, sizes: updatedSizes, updatedAt: new Date() });
        }
      } else {
        this.products.set(item.productId, {
          ...product,
          stock: Number(product.stock || 0) + quantity,
          updatedAt: new Date(),
        });
      }
    }

    const now = new Date();
    const currentTotal = Math.max(0, Number(order.totalAmount || 0));
    const currentPayments = normalizePositivePayments(
      (order.payments || []) as Array<{ method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"; amount: number }>
    );

    const updatedOrder: Order = {
      ...order,
      id: input.orderId,
      items,
      isCancelled: true,
      cancelledAt: now,
      cancelledBy: input.actorId,
      cancellationReason: safeReason || "Sem motivo informado",
    };
    this.orders.set(input.orderId, updatedOrder);

    // Only an OPEN register's running totals are safe to adjust — a CLOSED register has
    // already been reconciled and reported on (mirrors orders-db.ts's canAdjustRegister guard).
    const matchingRegister = this.findMatchingCashRegister(toDate(order.createdAt));
    if (matchingRegister && matchingRegister.status === "OPEN" && currentTotal > 0) {
      const byMethod = paymentAmountByMethod(currentPayments);
      this.cashRegisters.set(matchingRegister.id, {
        ...matchingRegister,
        totalSales: matchingRegister.totalSales - currentTotal,
        totalCash: matchingRegister.totalCash - byMethod.DINHEIRO,
        totalDebit: matchingRegister.totalDebit - byMethod.DEBITO,
        totalCredit: matchingRegister.totalCredit - byMethod.CREDITO,
        totalPix: matchingRegister.totalPix - byMethod.PIX,
        salesCount: matchingRegister.salesCount - 1,
      });
    }

    return updatedOrder;
  }

  async updateOrder(input: {
    orderId: string;
    discount: number;
    payments: Array<{ method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"; amount: number }>;
    actorId: string;
    actorRole: string;
  }): Promise<Order> {
    if (input.actorRole !== "ADMIN") {
      throw new Error("Only admins can edit sales");
    }

    const safeDiscount = Number(input.discount || 0);
    if (!Number.isFinite(safeDiscount) || safeDiscount < 0) {
      throw new Error("Discount must be a valid non-negative number");
    }

    const order = this.orders.get(input.orderId);
    if (!order) {
      throw new Error("Order not found");
    }
    if (order.isCancelled) {
      throw new Error("Cancelled sales cannot be edited");
    }
    if (order.isPaidLater) {
      throw new Error("Fiado sales cannot be edited in this screen");
    }

    const normalizedPayments = normalizePositivePayments(input.payments);
    const items = order.items || [];
    const subtotal = items.reduce((sum, item) => sum + Number(item.totalRevenue || 0), 0);
    if (safeDiscount > subtotal) {
      throw new Error("Discount cannot be greater than subtotal");
    }

    const nextTotalAmount = Math.max(0, subtotal - safeDiscount);
    const totalPaid = normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0);
    if (Math.abs(totalPaid - nextTotalAmount) > 0.01) {
      throw new Error("Payment total must match order total");
    }

    const matchingRegister = this.findMatchingCashRegister(toDate(order.createdAt));
    if (matchingRegister) {
      const previousByMethod = paymentAmountByMethod(
        normalizePositivePayments(
          (order.payments || []) as Array<{ method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"; amount: number }>
        )
      );
      const nextByMethod = paymentAmountByMethod(normalizedPayments);
      const previousTotal = Number(order.totalAmount || 0);
      const totalDelta = nextTotalAmount - previousTotal;

      this.cashRegisters.set(matchingRegister.id, {
        ...matchingRegister,
        totalSales: matchingRegister.totalSales + totalDelta,
        totalCash: matchingRegister.totalCash + (nextByMethod.DINHEIRO - previousByMethod.DINHEIRO),
        totalDebit: matchingRegister.totalDebit + (nextByMethod.DEBITO - previousByMethod.DEBITO),
        totalCredit: matchingRegister.totalCredit + (nextByMethod.CREDITO - previousByMethod.CREDITO),
        totalPix: matchingRegister.totalPix + (nextByMethod.PIX - previousByMethod.PIX),
      });
    }

    const updatedOrder: Order = {
      ...order,
      discount: safeDiscount,
      totalAmount: nextTotalAmount,
      payments: normalizedPayments,
      items,
    };
    this.orders.set(input.orderId, updatedOrder);
    return updatedOrder;
  }
}
