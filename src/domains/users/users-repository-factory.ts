import { getDemoSessionId } from "@/lib/demo/demo-context";
import { getDemoDataset } from "@/lib/demo/demo-store";
import { FirestoreUsersRepository } from "@/domains/users/firestore-users-repository";
import { InMemoryUsersRepository } from "@/domains/users/in-memory-users-repository";
import type { UsersRepository } from "@/domains/users/repository";

export function getUsersRepository(): UsersRepository {
  const sessionId = getDemoSessionId();
  const dataset = sessionId ? getDemoDataset(sessionId) : null;
  if (dataset) {
    return new InMemoryUsersRepository(dataset.users, dataset.idempotency.users);
  }
  return new FirestoreUsersRepository();
}
