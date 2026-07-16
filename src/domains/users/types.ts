export type { IdempotencyReservation } from "@/domains/shared/idempotency";

export interface CreateUserCommand {
  email: unknown;
  password: unknown;
  name: unknown;
  role: unknown;
  idempotencyKey: unknown;
}

export interface UpdateUserRoleCommand {
  id: unknown;
  role: unknown;
}

export interface DeactivateUserCommand {
  id: unknown;
  actorId: string;
}
