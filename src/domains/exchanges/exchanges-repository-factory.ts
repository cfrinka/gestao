import { getDemoSessionId } from "@/lib/demo/demo-context";
import { getDemoDataset } from "@/lib/demo/demo-store";
import { FirestoreExchangesRepository } from "@/domains/exchanges/firestore-exchanges-repository";
import { InMemoryExchangesRepository } from "@/domains/exchanges/in-memory-exchanges-repository";
import type { ExchangesRepository } from "@/domains/exchanges/repository";

export function getExchangesRepository(): ExchangesRepository {
  const sessionId = getDemoSessionId();
  const dataset = sessionId ? getDemoDataset(sessionId) : null;
  if (dataset) {
    return new InMemoryExchangesRepository(
      dataset.exchanges,
      dataset.products,
      dataset.cashRegisters,
      dataset.idempotency.exchanges,
      dataset.discountAuthorizations
    );
  }
  return new FirestoreExchangesRepository();
}
