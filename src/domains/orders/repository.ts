import type { Order } from "@/lib/db-types";

export interface OrdersRepository {
  getOrders(startDate?: Date, endDate?: Date): Promise<Order[]>;
  cancelOrder(input: {
    orderId: string;
    actorId: string;
    actorRole: string;
    reason?: string;
  }): Promise<Order>;
  updateOrder(input: {
    orderId: string;
    discount: number;
    payments: Array<{ method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"; amount: number }>;
    actorId: string;
    actorRole: string;
  }): Promise<Order>;
}
