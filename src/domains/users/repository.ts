import type { UserRecord } from "@/lib/db-types";
import type { IdempotencyReservation } from "@/domains/users/types";

export interface UsersRepository {
  getAll(): Promise<UserRecord[]>;
  getById(id: string): Promise<UserRecord | null>;

  createAuthUser(input: { email: string; password: string; name: string }): Promise<{ uid: string }>;
  deleteAuthUser(uid: string): Promise<void>;
  disableAuthUser(uid: string): Promise<void>;
  enableAuthUser(uid: string): Promise<void>;

  createUserRecord(input: { id: string; email: string; name: string; role: "ADMIN" | "CASHIER" }): Promise<UserRecord>;
  updateUserRole(id: string, role: "ADMIN" | "CASHIER"): Promise<UserRecord>;
  deactivateUserRecord(id: string, actorId: string): Promise<void>;
  reactivateUserRecord(id: string): Promise<void>;

  recordSyncError(input: { kind: string; userId: string; details: Record<string, unknown> }): Promise<void>;

  reserveIdempotency(input: { ownerId: string; idempotencyKey: string; requestHash: string }): Promise<IdempotencyReservation>;
  markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }): Promise<void>;
  markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }): Promise<void>;
}
