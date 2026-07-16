import { HttpError } from "@/lib/api/http-errors";
import type { UsersRepository } from "@/domains/users/repository";
import type { CreateUserCommand, DeactivateUserCommand, UpdateUserRoleCommand } from "@/domains/users/types";
import type { UserRecord } from "@/lib/db-types";

function toPublicErrorMessage(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (error instanceof Error) return error.message;
  return "Internal server error";
}

function isValidRole(role: string): role is "ADMIN" | "CASHIER" {
  return role === "ADMIN" || role === "CASHIER";
}

export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  async list(): Promise<UserRecord[]> {
    return this.repository.getAll();
  }

  // Firebase Auth and Firestore are two separate systems with no shared transaction, so
  // this can't be made atomic the way a single-Firestore operation can. Instead: reserve
  // the idempotency key up front (so a retry replays instead of creating a second Auth
  // user), and if the Firestore write fails after the Auth user was created, compensate
  // by deleting the Auth user. If that compensating delete also fails, don't silently
  // swallow the inconsistency — record it for manual reconciliation.
  async create(command: CreateUserCommand): Promise<UserRecord> {
    const email = String(command.email || "").trim();
    const password = String(command.password || "");
    const name = String(command.name || "").trim();
    const role = String(command.role || "");

    if (!email || !password || !name || !role) {
      throw new HttpError(400, "Missing required fields");
    }
    if (!isValidRole(role)) {
      throw new HttpError(400, "Invalid role");
    }

    const safeIdempotencyKey = String(command.idempotencyKey || "").trim();
    if (!safeIdempotencyKey) {
      throw new HttpError(400, "idempotencyKey is required");
    }

    const requestHash = JSON.stringify({ email, name, role });
    const reservation = await this.repository.reserveIdempotency({
      ownerId: email,
      idempotencyKey: safeIdempotencyKey,
      requestHash,
    });

    if (reservation.type === "conflict") {
      throw new HttpError(409, "Idempotency key reuse with different payload");
    }
    if (reservation.type === "completed") {
      return reservation.response as UserRecord;
    }
    if (reservation.type === "in_progress") {
      throw new HttpError(409, "Request already being processed");
    }

    let createdAuthUid: string | null = null;
    try {
      const authUser = await this.repository.createAuthUser({ email, password, name });
      createdAuthUid = authUser.uid;

      const record = await this.repository.createUserRecord({ id: authUser.uid, email, name, role });

      await this.repository.markIdempotencyCompleted({
        ownerId: email,
        idempotencyKey: safeIdempotencyKey,
        response: record,
      });

      return record;
    } catch (error) {
      if (createdAuthUid) {
        try {
          await this.repository.deleteAuthUser(createdAuthUid);
        } catch (compensationError) {
          await this.repository.recordSyncError({
            kind: "user-create-compensation-failed",
            userId: createdAuthUid,
            details: {
              createError: toPublicErrorMessage(error),
              compensationError: toPublicErrorMessage(compensationError),
            },
          });
        }
      }

      await this.repository.markIdempotencyFailed({
        ownerId: email,
        idempotencyKey: safeIdempotencyKey,
        errorMessage: toPublicErrorMessage(error),
      });
      throw error;
    }
  }

  async updateRole(command: UpdateUserRoleCommand): Promise<UserRecord> {
    const id = String(command.id || "").trim();
    const role = String(command.role || "");

    if (!id || !role) {
      throw new HttpError(400, "Missing required fields");
    }
    if (!isValidRole(role)) {
      throw new HttpError(400, "Invalid role");
    }

    const existing = await this.repository.getById(id);
    if (!existing) {
      throw new HttpError(404, "User not found");
    }

    return this.repository.updateUserRole(id, role);
  }

  // Firestore is updated first: if that fails, nothing has happened yet and the caller
  // can just retry. If the following Auth disable fails, the Firestore change is
  // reverted; if the revert also fails, the inconsistency (Firestore inactive, Auth
  // still enabled) is recorded for manual reconciliation rather than swallowed.
  async deactivate(command: DeactivateUserCommand): Promise<void> {
    const id = String(command.id || "").trim();
    if (!id) {
      throw new HttpError(400, "Missing user id");
    }
    if (id === command.actorId) {
      throw new HttpError(400, "You cannot deactivate your own user");
    }

    const existing = await this.repository.getById(id);
    if (!existing) {
      throw new HttpError(404, "User not found");
    }

    await this.repository.deactivateUserRecord(id, command.actorId);

    try {
      await this.repository.disableAuthUser(id);
    } catch (authError) {
      try {
        await this.repository.reactivateUserRecord(id);
      } catch (revertError) {
        await this.repository.recordSyncError({
          kind: "user-deactivate-revert-failed",
          userId: id,
          details: {
            authError: toPublicErrorMessage(authError),
            revertError: toPublicErrorMessage(revertError),
          },
        });
      }
      throw authError;
    }
  }
}
