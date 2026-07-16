import { getDemoSessionId } from "@/lib/demo/demo-context";
import { getDemoDataset } from "@/lib/demo/demo-store";
import { FirestoreStockAdjustmentsRepository } from "@/domains/stock-adjustments/firestore-stock-adjustments-repository";
import { InMemoryStockAdjustmentsRepository } from "@/domains/stock-adjustments/in-memory-stock-adjustments-repository";
import type { StockAdjustmentsRepository } from "@/domains/stock-adjustments/repository";

export function getStockAdjustmentsRepository(): StockAdjustmentsRepository {
  const sessionId = getDemoSessionId();
  const dataset = sessionId ? getDemoDataset(sessionId) : null;
  if (dataset) {
    return new InMemoryStockAdjustmentsRepository(
      dataset.products,
      dataset.stockAdjustments,
      dataset.idempotency.stockAdjustments
    );
  }
  return new FirestoreStockAdjustmentsRepository();
}
