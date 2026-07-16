import { HttpError } from "@/lib/api/http-errors";
import { getProduct } from "@/domains/products/products-db";
import type { OrdersRepository } from "@/domains/orders/repository";
import type { CancelOrderCommand, ListOrdersQuery, UpdateOrderCommand } from "@/domains/orders/types";
import type { Order } from "@/lib/db-types";

const RECENT_AUTH_WINDOW_SECONDS = 5 * 60;

export class OrdersService {
  constructor(private readonly repository: OrdersRepository) {}

  async list(query: ListOrdersQuery): Promise<unknown[]> {
    const orders = await this.repository.getOrders(query.startDate, query.endDate);

    return Promise.all(
      orders.map(async (order) => {
        const itemsWithDetails = await Promise.all(
          (order.items || []).map(async (item) => {
            const product = await getProduct(item.productId);
            return { ...item, product };
          })
        );

        const paymentHistory = Array.isArray((order as unknown as { paymentHistory?: unknown }).paymentHistory)
          ? (order as unknown as { paymentHistory: Array<{ createdAt?: unknown }> }).paymentHistory.map((p) => ({
              ...p,
              createdAt:
                p.createdAt && typeof p.createdAt === "object" && "toDate" in (p.createdAt as object)
                  ? (p.createdAt as { toDate: () => Date }).toDate()
                  : p.createdAt,
            }))
          : undefined;

        return { ...order, items: itemsWithDetails, ...(paymentHistory ? { paymentHistory } : {}) };
      })
    );
  }

  async cancel(command: CancelOrderCommand): Promise<Order> {
    const orderId = command.orderId.trim();
    if (!orderId) {
      throw new HttpError(400, "orderId is required");
    }

    const authTime = Number(command.authTime || 0);
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const isRecentAuth = authTime > 0 && nowInSeconds - authTime <= RECENT_AUTH_WINDOW_SECONDS;
    if (!isRecentAuth) {
      throw new HttpError(401, "Confirmação de senha expirada. Informe a senha novamente para cancelar a venda.");
    }

    try {
      return await this.repository.cancelOrder({
        orderId,
        reason: (command.reason || "").trim(),
        actorId: command.actorId,
        actorRole: command.actorRole,
      });
    } catch (error) {
      console.error("cancelOrder failed:", error);
      const message = error instanceof Error ? error.message : "Erro ao cancelar venda";
      throw new HttpError(400, message);
    }
  }

  async update(command: UpdateOrderCommand): Promise<Order> {
    const orderId = command.orderId.trim();
    if (!orderId) {
      throw new HttpError(400, "orderId is required");
    }

    return this.repository.updateOrder({
      orderId,
      discount: command.discount,
      payments: command.payments,
      actorId: command.actorId,
      actorRole: command.actorRole,
    });
  }
}
