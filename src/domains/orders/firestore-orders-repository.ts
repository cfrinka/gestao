import { cancelOrder, getOrders, updateOrder } from "@/domains/orders/orders-db";
import type { OrdersRepository } from "@/domains/orders/repository";
import type { Order } from "@/lib/db-types";

export class FirestoreOrdersRepository implements OrdersRepository {
  async getOrders(startDate?: Date, endDate?: Date): Promise<Order[]> {
    return getOrders(startDate, endDate);
  }

  async cancelOrder(input: {
    orderId: string;
    actorId: string;
    actorRole: string;
    reason?: string;
  }): Promise<Order> {
    return cancelOrder(input);
  }

  async updateOrder(input: {
    orderId: string;
    discount: number;
    payments: Array<{ method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"; amount: number }>;
    actorId: string;
    actorRole: string;
  }): Promise<Order> {
    return updateOrder(input);
  }
}
