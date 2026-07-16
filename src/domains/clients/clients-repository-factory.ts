import { getDemoSessionId } from "@/lib/demo/demo-context";
import { getDemoDataset } from "@/lib/demo/demo-store";
import { FirestoreClientsRepository } from "@/domains/clients/firestore-clients-repository";
import { InMemoryClientsRepository } from "@/domains/clients/in-memory-clients-repository";
import type { ClientsRepository } from "@/domains/clients/repository";

export function getClientsRepository(): ClientsRepository {
  const sessionId = getDemoSessionId();
  const dataset = sessionId ? getDemoDataset(sessionId) : null;
  if (dataset) {
    return new InMemoryClientsRepository(
      dataset.clients,
      dataset.orders,
      dataset.products,
      dataset.cashRegisters,
      dataset.debtCorrections
    );
  }
  return new FirestoreClientsRepository();
}
