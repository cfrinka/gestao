import { getDemoSessionId } from "@/lib/demo/demo-context";
import { getDemoDataset } from "@/lib/demo/demo-store";
import { FirestoreOrdersRepository } from "@/domains/orders/firestore-orders-repository";
import { InMemoryOrdersRepository } from "@/domains/orders/in-memory-orders-repository";
import type { OrdersRepository } from "@/domains/orders/repository";

export function getOrdersRepository(): OrdersRepository {
  const sessionId = getDemoSessionId();
  const dataset = sessionId ? getDemoDataset(sessionId) : null;
  if (dataset) {
    return new InMemoryOrdersRepository(dataset.orders, dataset.products, dataset.cashRegisters);
  }
  return new FirestoreOrdersRepository();
}
