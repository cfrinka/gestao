import { getDemoSessionId } from "@/lib/demo/demo-context";
import { getDemoDataset } from "@/lib/demo/demo-store";
import { FirestoreBillsRepository } from "@/domains/bills/firestore-bills-repository";
import { InMemoryBillsRepository } from "@/domains/bills/in-memory-bills-repository";
import type { BillsRepository } from "@/domains/bills/repository";

export function getBillsRepository(): BillsRepository {
  const sessionId = getDemoSessionId();
  const dataset = sessionId ? getDemoDataset(sessionId) : null;
  if (dataset) {
    return new InMemoryBillsRepository(dataset.bills, dataset.idempotency.bills);
  }
  return new FirestoreBillsRepository();
}
