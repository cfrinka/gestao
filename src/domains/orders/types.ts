export interface ListOrdersQuery {
  startDate?: Date;
  endDate?: Date;
}

export interface CancelOrderCommand {
  orderId: string;
  reason?: string;
  actorId: string;
  actorRole: string;
  authTime?: number;
}

export interface UpdateOrderCommand {
  orderId: string;
  discount: number;
  payments: Array<{ method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"; amount: number }>;
  customerPhone?: string;
  actorId: string;
  actorRole: string;
}
