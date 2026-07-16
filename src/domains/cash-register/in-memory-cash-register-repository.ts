import { randomUUID } from "crypto";
import type { CashRegisterRepository } from "@/domains/cash-register/repository";
import type { IdempotencyReservation } from "@/domains/cash-register/types";
import type { CashRegister, Order } from "@/lib/db-types";
import { HttpError } from "@/lib/api/http-errors";

export type CashRegisterIdempotencyEntry = {
  requestHash: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  response?: unknown;
};

/**
 * In-memory equivalent of FirestoreCashRegisterRepository for demo mode. Reads/writes the
 * caller's shared `cashRegisters` Map directly (see cash-register-db.ts for the real behavior
 * this mirrors) so totals stay consistent with whatever InMemoryCheckoutRepository writes into
 * the same Map when a sale is rung up against an open register.
 *
 * Not thread-safe by design — demo sessions are single-user, so the read-then-write races the
 * real Firestore transactions guard against (double-open, concurrent adjustment) can't occur here.
 */
export class InMemoryCashRegisterRepository implements CashRegisterRepository {
  constructor(
    private readonly cashRegisters: Map<string, CashRegister>,
    private readonly orders: Map<string, Order>,
    private readonly idempotency: Map<string, CashRegisterIdempotencyEntry>
  ) {}

  async getOpenRegister(userId: string): Promise<CashRegister | null> {
    for (const register of Array.from(this.cashRegisters.values())) {
      if (register.userId === userId && register.status === "OPEN") return register;
    }
    return null;
  }

  async openRegister(userId: string, userName: string, openingBalance: number): Promise<CashRegister> {
    const existing = await this.getOpenRegister(userId);
    if (existing) {
      throw new HttpError(400, "Já existe um caixa aberto");
    }

    const register: CashRegister = {
      id: randomUUID(),
      userId,
      userName,
      openedAt: new Date(),
      closedAt: null,
      openingBalance,
      closingBalance: null,
      status: "OPEN",
      totalSales: 0,
      totalCash: 0,
      totalDebit: 0,
      totalCredit: 0,
      totalPix: 0,
      totalCashSupply: 0,
      totalCashWithdrawal: 0,
      salesCount: 0,
      totalExchangeDifferenceIn: 0,
      exchangeDifferenceCount: 0,
    };

    this.cashRegisters.set(register.id, register);
    return register;
  }

  async closeRegister(registerId: string, closingBalance: number): Promise<CashRegister> {
    const register = this.cashRegisters.get(registerId);
    if (!register) {
      throw new HttpError(404, "Caixa não encontrado");
    }

    const updated: CashRegister = {
      ...register,
      closedAt: new Date(),
      closingBalance,
      status: "CLOSED",
    };
    this.cashRegisters.set(registerId, updated);
    return updated;
  }

  // Simplified vs. cash-register-db.ts's getCashRegisterOrders: this demo dataset has no
  // financialMovements/exchanges collections, so fiado-payment and exchange-difference entries
  // (which the real implementation merges in) are intentionally omitted — only real orders
  // created within the register's open window are returned.
  async getRegisterOrders(registerId: string): Promise<Order[]> {
    const register = this.cashRegisters.get(registerId);
    if (!register) return [];

    const openedAt = register.openedAt.getTime();
    const closedAt = register.closedAt ? register.closedAt.getTime() : Date.now();

    return Array.from(this.orders.values())
      .filter((order) => {
        const createdAt = order.createdAt instanceof Date ? order.createdAt.getTime() : new Date(order.createdAt).getTime();
        return createdAt >= openedAt && createdAt <= closedAt;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async applyAdjustment(input: {
    registerId: string;
    type: "SUPPLY" | "WITHDRAWAL";
    amount: number;
    note?: string;
    actorId: string;
    actorRole: string;
  }): Promise<CashRegister> {
    const amount = Number(input.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new HttpError(400, "Valor da movimentação deve ser maior que zero");
    }

    const register = this.cashRegisters.get(input.registerId);
    if (!register) {
      throw new HttpError(404, "Caixa não encontrado");
    }
    if (register.status !== "OPEN") {
      throw new HttpError(400, "Caixa não está aberto");
    }

    const availableCash =
      Number(register.openingBalance || 0) +
      Number(register.totalCash || 0) +
      Number(register.totalCashSupply || 0) -
      Number(register.totalCashWithdrawal || 0);

    if (input.type === "WITHDRAWAL" && amount > availableCash) {
      throw new HttpError(400, "Saldo em dinheiro insuficiente para sangria");
    }

    const updated: CashRegister = {
      ...register,
      totalCashSupply: register.totalCashSupply + (input.type === "SUPPLY" ? amount : 0),
      totalCashWithdrawal: register.totalCashWithdrawal + (input.type === "WITHDRAWAL" ? amount : 0),
    };
    this.cashRegisters.set(input.registerId, updated);
    return updated;
  }

  async reserveIdempotency(input: {
    ownerId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<IdempotencyReservation> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotency.get(key);

    if (!existing) {
      this.idempotency.set(key, { requestHash: input.requestHash, status: "PROCESSING" });
      return { type: "new" };
    }
    if (existing.requestHash !== input.requestHash) {
      return { type: "conflict" };
    }
    if (existing.status === "COMPLETED") {
      return { type: "completed", response: existing.response };
    }
    if (existing.status === "PROCESSING") {
      return { type: "in_progress" };
    }

    existing.status = "PROCESSING";
    return { type: "new" };
  }

  async markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }): Promise<void> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotency.get(key);
    if (existing) {
      existing.status = "COMPLETED";
      existing.response = input.response;
    }
  }

  async markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }): Promise<void> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotency.get(key);
    if (existing) existing.status = "FAILED";
  }
}
