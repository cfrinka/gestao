import { describe, expect, it } from "vitest";
import { UsersService } from "./users-service";
import type { UsersRepository } from "./repository";
import type { UserRecord } from "@/lib/db-types";
import { HttpError } from "@/lib/api/http-errors";

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-1",
    email: "user@test.com",
    name: "Test User",
    role: "CASHIER",
    isActive: true,
    deactivatedAt: null,
    deactivatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakeUsersRepository implements UsersRepository {
  users = new Map<string, UserRecord>();
  authUsers = new Set<string>();
  disabledAuthUsers = new Set<string>();
  syncErrors: unknown[] = [];
  idempotencyStore = new Map<string, { requestHash: string; status: "PROCESSING" | "COMPLETED" | "FAILED"; response?: unknown }>();

  failCreateAuthUser = false;
  failCreateUserRecord = false;
  failDeleteAuthUser = false;
  failDisableAuthUser = false;
  failReactivateUserRecord = false;

  seed(user: UserRecord) {
    this.users.set(user.id, user);
    this.authUsers.add(user.id);
  }

  async getAll(): Promise<UserRecord[]> {
    return Array.from(this.users.values());
  }

  async getById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) || null;
  }

  async createAuthUser(input: { email: string; password: string; name: string }): Promise<{ uid: string }> {
    if (this.failCreateAuthUser) throw new Error("auth create failed");
    const uid = `auth-${this.authUsers.size + 1}`;
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

  async createUserRecord(input: { id: string; email: string; name: string; role: "ADMIN" | "CASHIER" }): Promise<UserRecord> {
    if (this.failCreateUserRecord) throw new Error("firestore create failed");
    const user = makeUser({ ...input, isActive: true });
    this.users.set(input.id, user);
    return user;
  }

  async updateUserRole(id: string, role: "ADMIN" | "CASHIER"): Promise<UserRecord> {
    const existing = this.users.get(id);
    if (!existing) throw new HttpError(404, "User not found");
    const updated = { ...existing, role };
    this.users.set(id, updated);
    return updated;
  }

  async deactivateUserRecord(id: string, actorId: string): Promise<void> {
    const existing = this.users.get(id);
    if (!existing) throw new HttpError(404, "User not found");
    this.users.set(id, { ...existing, isActive: false, deactivatedBy: actorId, deactivatedAt: new Date() });
  }

  async reactivateUserRecord(id: string): Promise<void> {
    if (this.failReactivateUserRecord) throw new Error("firestore revert failed");
    const existing = this.users.get(id);
    if (!existing) throw new HttpError(404, "User not found");
    this.users.set(id, { ...existing, isActive: true, deactivatedBy: null, deactivatedAt: null });
  }

  async recordSyncError(input: { kind: string; userId: string; details: Record<string, unknown> }): Promise<void> {
    this.syncErrors.push(input);
  }

  async reserveIdempotency(input: { ownerId: string; idempotencyKey: string; requestHash: string }) {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotencyStore.get(key);
    if (!existing) {
      this.idempotencyStore.set(key, { requestHash: input.requestHash, status: "PROCESSING" as const });
      return { type: "new" as const };
    }
    if (existing.requestHash !== input.requestHash) return { type: "conflict" as const };
    if (existing.status === "COMPLETED") return { type: "completed" as const, response: existing.response };
    if (existing.status === "PROCESSING") return { type: "in_progress" as const };
    existing.status = "PROCESSING";
    return { type: "new" as const };
  }
  async markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }) {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotencyStore.get(key);
    if (existing) {
      existing.status = "COMPLETED";
      existing.response = input.response;
    }
  }
  async markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string }) {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotencyStore.get(key);
    if (existing) existing.status = "FAILED";
  }
}

function baseCreateCommand(overrides: Record<string, unknown> = {}) {
  return {
    email: "new@test.com",
    password: "supersecret",
    name: "New User",
    role: "CASHIER",
    idempotencyKey: "key-1",
    ...overrides,
  };
}

describe("UsersService.create", () => {
  it("rejects missing required fields", async () => {
    const service = new UsersService(new FakeUsersRepository());
    await expect(service.create(baseCreateCommand({ name: "" }))).rejects.toThrow(HttpError);
  });

  it("rejects an invalid role", async () => {
    const service = new UsersService(new FakeUsersRepository());
    await expect(service.create(baseCreateCommand({ role: "OWNER" }))).rejects.toThrow(HttpError);
  });

  it("rejects a missing idempotency key", async () => {
    const service = new UsersService(new FakeUsersRepository());
    await expect(service.create(baseCreateCommand({ idempotencyKey: "" }))).rejects.toThrow(HttpError);
  });

  it("creates the Auth user and the Firestore record", async () => {
    const repo = new FakeUsersRepository();
    const service = new UsersService(repo);
    const user = await service.create(baseCreateCommand());
    expect(user.email).toBe("new@test.com");
    expect(repo.authUsers.size).toBe(1);
    expect(repo.users.size).toBe(1);
  });

  it("replays the cached response on a completed retry without creating a second Auth user", async () => {
    const repo = new FakeUsersRepository();
    const service = new UsersService(repo);
    const command = baseCreateCommand();

    await service.create(command);
    expect(repo.authUsers.size).toBe(1);

    await service.create(command);
    expect(repo.authUsers.size).toBe(1);
  });

  it("compensates by deleting the Auth user when the Firestore write fails", async () => {
    const repo = new FakeUsersRepository();
    repo.failCreateUserRecord = true;
    const service = new UsersService(repo);

    await expect(service.create(baseCreateCommand())).rejects.toThrow("firestore create failed");
    expect(repo.authUsers.size).toBe(0);
    expect(repo.syncErrors).toHaveLength(0);
  });

  it("records a sync error when both the Firestore write and the compensating Auth delete fail", async () => {
    const repo = new FakeUsersRepository();
    repo.failCreateUserRecord = true;
    repo.failDeleteAuthUser = true;
    const service = new UsersService(repo);

    await expect(service.create(baseCreateCommand())).rejects.toThrow("firestore create failed");
    expect(repo.authUsers.size).toBe(1);
    expect(repo.syncErrors).toHaveLength(1);
    expect(repo.syncErrors[0]).toMatchObject({ kind: "user-create-compensation-failed" });
  });
});

describe("UsersService.updateRole", () => {
  it("rejects when the user does not exist", async () => {
    const service = new UsersService(new FakeUsersRepository());
    await expect(service.updateRole({ id: "missing", role: "ADMIN" })).rejects.toThrow(HttpError);
  });

  it("rejects an invalid role", async () => {
    const repo = new FakeUsersRepository();
    repo.seed(makeUser());
    const service = new UsersService(repo);
    await expect(service.updateRole({ id: "user-1", role: "OWNER" })).rejects.toThrow(HttpError);
  });

  it("updates the role", async () => {
    const repo = new FakeUsersRepository();
    repo.seed(makeUser({ role: "CASHIER" }));
    const service = new UsersService(repo);
    const updated = await service.updateRole({ id: "user-1", role: "ADMIN" });
    expect(updated.role).toBe("ADMIN");
  });
});

describe("UsersService.deactivate", () => {
  it("rejects deactivating your own user", async () => {
    const repo = new FakeUsersRepository();
    repo.seed(makeUser({ id: "user-1" }));
    const service = new UsersService(repo);
    await expect(service.deactivate({ id: "user-1", actorId: "user-1" })).rejects.toThrow(HttpError);
  });

  it("rejects when the user does not exist", async () => {
    const service = new UsersService(new FakeUsersRepository());
    await expect(service.deactivate({ id: "missing", actorId: "admin-1" })).rejects.toThrow(HttpError);
  });

  it("deactivates Firestore first, then disables Auth", async () => {
    const repo = new FakeUsersRepository();
    repo.seed(makeUser({ id: "user-1" }));
    const service = new UsersService(repo);
    await service.deactivate({ id: "user-1", actorId: "admin-1" });
    expect(repo.users.get("user-1")?.isActive).toBe(false);
    expect(repo.disabledAuthUsers.has("user-1")).toBe(true);
  });

  it("reverts the Firestore deactivation when disabling Auth fails", async () => {
    const repo = new FakeUsersRepository();
    repo.seed(makeUser({ id: "user-1" }));
    repo.failDisableAuthUser = true;
    const service = new UsersService(repo);

    await expect(service.deactivate({ id: "user-1", actorId: "admin-1" })).rejects.toThrow("auth disable failed");
    expect(repo.users.get("user-1")?.isActive).toBe(true);
    expect(repo.syncErrors).toHaveLength(0);
  });

  it("records a sync error when both disabling Auth and reverting Firestore fail", async () => {
    const repo = new FakeUsersRepository();
    repo.seed(makeUser({ id: "user-1" }));
    repo.failDisableAuthUser = true;
    repo.failReactivateUserRecord = true;
    const service = new UsersService(repo);

    await expect(service.deactivate({ id: "user-1", actorId: "admin-1" })).rejects.toThrow("auth disable failed");
    expect(repo.users.get("user-1")?.isActive).toBe(false);
    expect(repo.syncErrors).toHaveLength(1);
    expect(repo.syncErrors[0]).toMatchObject({ kind: "user-deactivate-revert-failed" });
  });
});
