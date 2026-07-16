import { describe, expect, it } from "vitest";
import { UsersService } from "./users-service";
import { InMemoryUsersRepository } from "./in-memory-users-repository";
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

function makeRepo(): InMemoryUsersRepository {
  return new InMemoryUsersRepository(new Map(), new Map());
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

describe("UsersService.list", () => {
  it("delegates to the repository", async () => {
    const repo = makeRepo();
    repo.seed(makeUser());
    const service = new UsersService(repo);
    const result = await service.list();
    expect(result).toHaveLength(1);
  });
});

describe("UsersService.create", () => {
  it("rejects missing required fields", async () => {
    const service = new UsersService(makeRepo());
    await expect(service.create(baseCreateCommand({ name: "" }))).rejects.toThrow(HttpError);
  });

  it("rejects an invalid role", async () => {
    const service = new UsersService(makeRepo());
    await expect(service.create(baseCreateCommand({ role: "OWNER" }))).rejects.toThrow(HttpError);
  });

  it("rejects a missing idempotency key", async () => {
    const service = new UsersService(makeRepo());
    await expect(service.create(baseCreateCommand({ idempotencyKey: "" }))).rejects.toThrow(HttpError);
  });

  it("creates the Auth user and the Firestore record", async () => {
    const repo = makeRepo();
    const service = new UsersService(repo);
    const user = await service.create(baseCreateCommand());
    expect(user.email).toBe("new@test.com");
    expect(repo.authUsers.size).toBe(1);
    expect(repo.users.size).toBe(1);
  });

  it("replays the cached response on a completed retry without creating a second Auth user", async () => {
    const repo = makeRepo();
    const service = new UsersService(repo);
    const command = baseCreateCommand();

    await service.create(command);
    expect(repo.authUsers.size).toBe(1);

    await service.create(command);
    expect(repo.authUsers.size).toBe(1);
  });

  it("compensates by deleting the Auth user when the Firestore write fails", async () => {
    const repo = makeRepo();
    repo.failCreateUserRecord = true;
    const service = new UsersService(repo);

    await expect(service.create(baseCreateCommand())).rejects.toThrow("firestore create failed");
    expect(repo.authUsers.size).toBe(0);
    expect(repo.syncErrors).toHaveLength(0);
  });

  it("records a sync error when both the Firestore write and the compensating Auth delete fail", async () => {
    const repo = makeRepo();
    repo.failCreateUserRecord = true;
    repo.failDeleteAuthUser = true;
    const service = new UsersService(repo);

    await expect(service.create(baseCreateCommand())).rejects.toThrow("firestore create failed");
    expect(repo.authUsers.size).toBe(1);
    expect(repo.syncErrors).toHaveLength(1);
    expect(repo.syncErrors[0]).toMatchObject({ kind: "user-create-compensation-failed" });
  });

  it("preserves an HttpError's identity when the Firestore write fails with one", async () => {
    const repo = makeRepo();
    repo.createUserRecordError = new HttpError(422, "invalid role for this tenant");
    const service = new UsersService(repo);

    await expect(service.create(baseCreateCommand())).rejects.toMatchObject({
      statusCode: 422,
      message: "invalid role for this tenant",
    });
  });

  it("rejects idempotency key reuse with a different payload as a conflict", async () => {
    const repo = makeRepo();
    const service = new UsersService(repo);
    await service.create(baseCreateCommand({ idempotencyKey: "same-key" }));
    await expect(
      service.create(baseCreateCommand({ idempotencyKey: "same-key", name: "Different Name" }))
    ).rejects.toThrow(HttpError);
  });

  it("returns 409 when the same idempotency key is already being processed", async () => {
    const repo = makeRepo();
    const command = baseCreateCommand({ idempotencyKey: "in-progress-key" });
    const requestHash = JSON.stringify({ email: command.email, name: command.name, role: command.role });
    repo.idempotencyStore.set(`${command.email}:in-progress-key`, { requestHash, status: "PROCESSING" });

    const service = new UsersService(repo);
    await expect(service.create(command)).rejects.toThrow(HttpError);
  });
});

describe("UsersService.updateRole", () => {
  it("rejects a missing id or role", async () => {
    const service = new UsersService(makeRepo());
    await expect(service.updateRole({ id: "", role: "ADMIN" })).rejects.toThrow(HttpError);
    await expect(service.updateRole({ id: "user-1", role: "" })).rejects.toThrow(HttpError);
  });

  it("rejects when the user does not exist", async () => {
    const service = new UsersService(makeRepo());
    await expect(service.updateRole({ id: "missing", role: "ADMIN" })).rejects.toThrow(HttpError);
  });

  it("rejects an invalid role", async () => {
    const repo = makeRepo();
    repo.seed(makeUser());
    const service = new UsersService(repo);
    await expect(service.updateRole({ id: "user-1", role: "OWNER" })).rejects.toThrow(HttpError);
  });

  it("updates the role", async () => {
    const repo = makeRepo();
    repo.seed(makeUser({ role: "CASHIER" }));
    const service = new UsersService(repo);
    const updated = await service.updateRole({ id: "user-1", role: "ADMIN" });
    expect(updated.role).toBe("ADMIN");
  });
});

describe("UsersService.deactivate", () => {
  it("rejects a missing user id", async () => {
    const service = new UsersService(makeRepo());
    await expect(service.deactivate({ id: "", actorId: "admin-1" })).rejects.toThrow(HttpError);
  });

  it("rejects deactivating your own user", async () => {
    const repo = makeRepo();
    repo.seed(makeUser({ id: "user-1" }));
    const service = new UsersService(repo);
    await expect(service.deactivate({ id: "user-1", actorId: "user-1" })).rejects.toThrow(HttpError);
  });

  it("rejects when the user does not exist", async () => {
    const service = new UsersService(makeRepo());
    await expect(service.deactivate({ id: "missing", actorId: "admin-1" })).rejects.toThrow(HttpError);
  });

  it("deactivates Firestore first, then disables Auth", async () => {
    const repo = makeRepo();
    repo.seed(makeUser({ id: "user-1" }));
    const service = new UsersService(repo);
    await service.deactivate({ id: "user-1", actorId: "admin-1" });
    expect(repo.users.get("user-1")?.isActive).toBe(false);
    expect(repo.disabledAuthUsers.has("user-1")).toBe(true);
  });

  it("reverts the Firestore deactivation when disabling Auth fails", async () => {
    const repo = makeRepo();
    repo.seed(makeUser({ id: "user-1" }));
    repo.failDisableAuthUser = true;
    const service = new UsersService(repo);

    await expect(service.deactivate({ id: "user-1", actorId: "admin-1" })).rejects.toThrow("auth disable failed");
    expect(repo.users.get("user-1")?.isActive).toBe(true);
    expect(repo.syncErrors).toHaveLength(0);
  });

  it("records a sync error when both disabling Auth and reverting Firestore fail", async () => {
    const repo = makeRepo();
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
