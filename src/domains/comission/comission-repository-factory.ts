import { getDemoSessionId } from "@/lib/demo/demo-context";
import { getDemoDataset } from "@/lib/demo/demo-store";
import { FirestoreCommissionRepository } from "@/domains/comission/firestore-comission-repository";
import { InMemoryCommissionRepository } from "@/domains/comission/in-memory-comission-repository";
import type { CommissionRepository } from "@/domains/comission/repository";

export function getCommissionRepository(): CommissionRepository {
  const sessionId = getDemoSessionId();
  const dataset = sessionId ? getDemoDataset(sessionId) : null;
  if (dataset) {
    return new InMemoryCommissionRepository(dataset.orders, dataset.users);
  }
  return new FirestoreCommissionRepository();
}
