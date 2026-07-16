import { getDemoSessionId } from "@/lib/demo/demo-context";
import { getDemoDataset } from "@/lib/demo/demo-store";
import { FirestoreFinancialRepository } from "@/domains/financial/firestore-financial-repository";
import { InMemoryFinancialRepository } from "@/domains/financial/in-memory-financial-repository";
import type { FinancialRepository } from "@/domains/financial/repository";

export function getFinancialRepository(): FinancialRepository {
  const sessionId = getDemoSessionId();
  const dataset = sessionId ? getDemoDataset(sessionId) : null;
  if (dataset) {
    return new InMemoryFinancialRepository(
      dataset.orders,
      dataset.bills,
      dataset.products,
      dataset.clients,
      dataset.cashRegisters,
      dataset.closedFinancialMonths
    );
  }
  return new FirestoreFinancialRepository();
}
