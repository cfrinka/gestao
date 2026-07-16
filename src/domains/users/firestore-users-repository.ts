import {
  getUsers,
  getUser,
  createAuthUser,
  deleteAuthUser,
  disableAuthUser,
  enableAuthUser,
  createUserRecord,
  updateUserRole,
  deactivateUserRecord,
  reactivateUserRecord,
  recordSyncError,
} from "@/domains/users/users-db";
import { markIdempotencyCompleted, markIdempotencyFailed, reserveIdempotency } from "@/domains/shared/idempotency";
import type { UsersRepository } from "@/domains/users/repository";
import type { IdempotencyReservation } from "@/domains/users/types";
import type { UserRecord } from "@/lib/db-types";

const SCOPE = "users-create";

export class FirestoreUsersRepository implements UsersRepository {
  async getAll(): Promise<UserRecord[]> {
    return getUsers();
  }

  async getById(id: string): Promise<UserRecord | null> {
    return getUser(id);
  }

  async createAuthUser(input: { email: string; password: string; name: string }): Promise<{ uid: string }> {
    return createAuthUser(input);
  }

  async deleteAuthUser(uid: string): Promise<void> {
    return deleteAuthUser(uid);
  }

  async disableAuthUser(uid: string): Promise<void> {
    return disableAuthUser(uid);
  }

  async enableAuthUser(uid: string): Promise<void> {
    return enableAuthUser(uid);
  }

  async createUserRecord(input: { id: string; email: string; name: string; role: "ADMIN" | "CASHIER" }): Promise<UserRecord> {
    return createUserRecord(input);
  }

  async updateUserRole(id: string, role: "ADMIN" | "CASHIER"): Promise<UserRecord> {
    return updateUserRole(id, role);
  }

  async deactivateUserRecord(id: string, actorId: string): Promise<void> {
    return deactivateUserRecord(id, actorId);
  }

  async reactivateUserRecord(id: string): Promise<void> {
    return reactivateUserRecord(id);
  }

  async recordSyncError(input: { kind: string; userId: string; details: Record<string, unknown> }): Promise<void> {
    return recordSyncError(input);
  }

  async reserveIdempotency(input: {
    ownerId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<IdempotencyReservation> {
    return reserveIdempotency(SCOPE, input.ownerId, input.idempotencyKey, input.requestHash);
  }

  async markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }): Promise<void> {
    await markIdempotencyCompleted(SCOPE, input.ownerId, input.idempotencyKey, input.response);
  }

  async markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }): Promise<void> {
    await markIdempotencyFailed(SCOPE, input.ownerId, input.idempotencyKey, input.errorMessage);
  }
}
