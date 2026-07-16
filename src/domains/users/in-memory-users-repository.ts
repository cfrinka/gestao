import { randomUUID } from "crypto";
import { HttpError } from "@/lib/api/http-errors";
import type { UsersRepository } from "@/domains/users/repository";
import type { IdempotencyReservation } from "@/domains/users/types";
import type { UserRecord } from "@/lib/db-types";

export type IdempotencyEntry = {
  requestHash: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  response?: unknown;
};

/**
 * In-memory stand-in for FirestoreUsersRepository, used by demo mode. In a real demo session
 * the only user records that exist are the two fixed demo identities (Admin/Cashier), but the
 * full interface is implemented faithfully so an Admin browsing /users in the demo sees the
 * same create/update-role/deactivate behavior as the real screen.
 *
 * There's no Firebase Auth in demo mode, so `authUsers`/`disabledAuthUsers` are just
 * request-local bookkeeping (nothing outside a single request ever needs to know "is this uid
 * disabled" — the durable source of truth is the `isActive` flag on the UserRecord itself,
 * which lives in the shared `users` Map). They are not part of DemoDataset and don't need to
 * survive across requests.
 */
export class InMemoryUsersRepository implements UsersRepository {
  authUsers = new Set<string>();
  disabledAuthUsers = new Set<string>();
  syncErrors: Array<{ kind: string; userId: string; details: Record<string, unknown> }> = [];

  // Test-only failure injection, carried over from the original FakeUsersRepository test
  // double (users-service.test.ts) so its assertions keep working unchanged. Unused during
  // real demo traffic.
  failCreateAuthUser = false;
  failCreateUserRecord = false;
  failDeleteAuthUser = false;
  failDisableAuthUser = false;
  failReactivateUserRecord = false;
  createUserRecordError: Error | null = null;

  constructor(
    public users: Map<string, UserRecord>,
    public idempotencyStore: Map<string, IdempotencyEntry>
  ) {}

  seed(user: UserRecord): void {
    this.users.set(user.id, user);
    this.authUsers.add(user.id);
  }

  async getAll(): Promise<UserRecord[]> {
    return Array.from(this.users.values());
  }

  async getById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) || null;
  }

  async createAuthUser(_input: { email: string; password: string; name: string }): Promise<{ uid: string }> {
    if (this.failCreateAuthUser) throw new Error("auth create failed");
    const uid = randomUUID();
    this.authUsers.add(uid);
    return { uid };
  }

  async deleteAuthUser(uid: string): Promise<void> {
    if (this.failDeleteAuthUser) throw new Error("auth delete failed");
    this.authUsers.delete(uid);
  }

  async disableAuthUser(uid: string): Promise<void> {
    if (this.failDisableAuthUser) throw new Error("auth disable failed");
    this.disabledAuthUsers.add(uid);
  }

  async enableAuthUser(uid: string): Promise<void> {
    this.disabledAuthUsers.delete(uid);
  }

  async createUserRecord(input: {
    id: string;
    email: string;
    name: string;
    role: "ADMIN" | "CASHIER";
  }): Promise<UserRecord> {
    if (this.createUserRecordError) throw this.createUserRecordError;
    if (this.failCreateUserRecord) throw new Error("firestore create failed");
    const now = new Date();
    const user: UserRecord = {
      id: input.id,
      email: input.email,
      name: input.name,
      role: input.role,
      isActive: true,
      deactivatedAt: null,
      deactivatedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(input.id, user);
    return user;
  }

  async updateUserRole(id: string, role: "ADMIN" | "CASHIER"): Promise<UserRecord> {
    const existing = this.users.get(id);
    if (!existing) throw new HttpError(404, "User not found");
    const updated: UserRecord = { ...existing, role, updatedAt: new Date() };
    this.users.set(id, updated);
    return updated;
  }

  async deactivateUserRecord(id: string, actorId: string): Promise<void> {
    const existing = this.users.get(id);
    if (!existing) throw new HttpError(404, "User not found");
    this.users.set(id, {
      ...existing,
      isActive: false,
      deactivatedBy: actorId,
      deactivatedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async reactivateUserRecord(id: string): Promise<void> {
    if (this.failReactivateUserRecord) throw new Error("firestore revert failed");
    const existing = this.users.get(id);
    if (!existing) throw new HttpError(404, "User not found");
    this.users.set(id, {
      ...existing,
      isActive: true,
      deactivatedBy: null,
      deactivatedAt: null,
      updatedAt: new Date(),
    });
  }

  async recordSyncError(input: { kind: string; userId: string; details: Record<string, unknown> }): Promise<void> {
    this.syncErrors.push(input);
  }

  async reserveIdempotency(input: {
    ownerId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<IdempotencyReservation> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotencyStore.get(key);
    if (!existing) {
      this.idempotencyStore.set(key, { requestHash: input.requestHash, status: "PROCESSING" });
      return { type: "new" };
    }
    if (existing.requestHash !== input.requestHash) return { type: "conflict" };
    if (existing.status === "COMPLETED") return { type: "completed", response: existing.response };
    if (existing.status === "PROCESSING") return { type: "in_progress" };
    existing.status = "PROCESSING";
    return { type: "new" };
  }

  async markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }): Promise<void> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotencyStore.get(key);
    if (existing) {
      existing.status = "COMPLETED";
      existing.response = input.response;
    }
  }

  async markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }): Promise<void> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotencyStore.get(key);
    if (existing) existing.status = "FAILED";
  }
}
