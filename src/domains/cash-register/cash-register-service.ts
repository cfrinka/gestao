import { HttpError } from "@/lib/api/http-errors";
import { getUser } from "@/domains/users/users-db";
import { isDemoMode } from "@/lib/demo/demo-mode";
import type { CashRegisterRepository } from "@/domains/cash-register/repository";
import type { AdjustmentCommand, AdjustmentExecutionResult } from "@/domains/cash-register/types";
import type { CashRegister, Order } from "@/lib/db-types";

function toPublicErrorMessage(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (error instanceof Error) return error.message;
  return "Internal server error";
}

export class CashRegisterService {
  constructor(private readonly repository: CashRegisterRepository) {}

  async getOpen(userId: string): Promise<CashRegister | null> {
    return this.repository.getOpenRegister(userId);
  }

  async open(userId: string, userEmail: string, openingBalance: number): Promise<CashRegister> {
    const existing = await this.repository.getOpenRegister(userId);
    if (existing) {
      throw new HttpError(400, "Já existe um caixa aberto");
    }

    // In demo mode there's no real Firestore `users` collection to query — getUser would throw
    // for lack of credentials. The caller-supplied userEmail (the demo user's display email) is
    // a safe, always-available fallback.
    const userName = isDemoMode() ? userEmail : (await getUser(userId))?.name || userEmail;
    return this.repository.openRegister(userId, userName, Number(openingBalance || 0));
  }

  async close(userId: string, closingBalance: number): Promise<{ register: CashRegister; orders: Order[] }> {
    const register = await this.repository.getOpenRegister(userId);
    if (!register) {
      throw new HttpError(400, "Nenhum caixa aberto");
    }

    const orders = await this.repository.getRegisterOrders(register.id);
    const closedRegister = await this.repository.closeRegister(register.id, Number(closingBalance || 0));
    return { register: closedRegister, orders };
  }

  async adjust(command: AdjustmentCommand): Promise<AdjustmentExecutionResult> {
    const register = await this.repository.getOpenRegister(command.userId);
    if (!register) {
      throw new HttpError(400, "Nenhum caixa aberto");
    }

    const safeIdempotencyKey = String(command.idempotencyKey || "").trim();
    if (!safeIdempotencyKey) {
      throw new HttpError(400, "idempotencyKey is required");
    }

    const amount = Number(command.amount || 0);
    const note = typeof command.note === "string" ? command.note : undefined;

    const requestHash = JSON.stringify({
      registerId: register.id,
      type: command.type,
      amount,
      note: note || null,
      userId: command.userId,
    });

    const reservation = await this.repository.reserveIdempotency({
      ownerId: command.userId,
      idempotencyKey: safeIdempotencyKey,
      requestHash,
    });

    if (reservation.type === "conflict") {
      throw new HttpError(409, "Idempotency key reuse with different payload");
    }
    if (reservation.type === "completed") {
      return { status: 200, body: reservation.response };
    }
    if (reservation.type === "in_progress") {
      return { status: 409, body: { error: "Request already being processed" } };
    }

    try {
      const updated = await this.repository.applyAdjustment({
        registerId: register.id,
        type: command.type,
        amount,
        note,
        actorId: command.actorId,
        actorRole: command.actorRole,
      });

      const body = { register: updated };

      await this.repository.markIdempotencyCompleted({
        ownerId: command.userId,
        idempotencyKey: safeIdempotencyKey,
        response: body,
      });

      return { status: 201, body };
    } catch (error) {
      await this.repository.markIdempotencyFailed({
        ownerId: command.userId,
        idempotencyKey: safeIdempotencyKey,
        errorMessage: toPublicErrorMessage(error),
      });
      throw error;
    }
  }
}
