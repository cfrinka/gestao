import {
  DIFFERENCE_NOTE_REQUIRED,
  HttpError,
  IDEMPOTENCY_CONFLICT_MESSAGE,
  IDEMPOTENCY_IN_PROGRESS_MESSAGE,
  IDEMPOTENCY_KEY_REQUIRED_MESSAGE,
} from "@/lib/api/http-errors";
import { roundMoney } from "@/lib/money";
import { formatCurrency } from "@/lib/utils";
import { differenceNeedsNote, registerCashDifference } from "@/domains/cash-register/register-difference";
import { getUser } from "@/domains/users/users-db";
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

    const userData = await getUser(userId);
    const userName = userData?.name || userEmail;
    return this.repository.openRegister(userId, userName, Number(openingBalance || 0));
  }

  /**
   * Closes the operator's register with the cash counted. A difference above the store's
   * tolerance needs the reason, which is kept with the closing for the differences report.
   */
  async close(
    userId: string,
    closingBalance: number,
    options: { note?: unknown; tolerance?: number } = {}
  ): Promise<{ register: CashRegister; orders: Order[] }> {
    const register = await this.repository.getOpenRegister(userId);
    if (!register) {
      throw new HttpError(400, "Nenhum caixa aberto");
    }

    const counted = roundMoney(Number(closingBalance || 0));
    const note = typeof options.note === "string" ? options.note.trim().slice(0, 500) : "";
    const difference = registerCashDifference(register, counted);
    if (!note && options.tolerance !== undefined && differenceNeedsNote(difference, options.tolerance)) {
      throw new HttpError(
        400,
        `${difference < 0 ? "Faltam" : "Sobram"} ${formatCurrency(Math.abs(difference))} no caixa. Escreva o motivo antes de fechar.`,
        true,
        DIFFERENCE_NOTE_REQUIRED
      );
    }

    const orders = await this.repository.getRegisterOrders(register.id);
    const closedRegister = await this.repository.closeRegister(register.id, counted, note || undefined);
    return { register: closedRegister, orders };
  }

  async adjust(command: AdjustmentCommand): Promise<AdjustmentExecutionResult> {
    const register = await this.repository.getOpenRegister(command.userId);
    if (!register) {
      throw new HttpError(400, "Nenhum caixa aberto");
    }

    const safeIdempotencyKey = String(command.idempotencyKey || "").trim();
    if (!safeIdempotencyKey) {
      throw new HttpError(400, IDEMPOTENCY_KEY_REQUIRED_MESSAGE);
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
      throw new HttpError(409, IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    if (reservation.type === "completed") {
      return { status: 200, body: reservation.response };
    }
    if (reservation.type === "in_progress") {
      return { status: 409, body: { error: IDEMPOTENCY_IN_PROGRESS_MESSAGE } };
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
