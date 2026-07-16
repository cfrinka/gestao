import {
  applyCashRegisterAdjustment,
  closeCashRegister,
  getCashRegisterOrders,
  getOpenCashRegister,
  openCashRegister,
} from "@/domains/cash-register/cash-register-db";
import { markIdempotencyCompleted, markIdempotencyFailed, reserveIdempotency } from "@/domains/shared/idempotency";
import type { CashRegisterRepository } from "@/domains/cash-register/repository";
import type { IdempotencyReservation } from "@/domains/cash-register/types";
import type { CashRegister, Order } from "@/lib/db-types";

const SCOPE = "cash-register-adjustment";

export class FirestoreCashRegisterRepository implements CashRegisterRepository {
  async getOpenRegister(userId: string): Promise<CashRegister | null> {
    return getOpenCashRegister(userId);
  }

  async openRegister(userId: string, userName: string, openingBalance: number): Promise<CashRegister> {
    return openCashRegister(userId, userName, openingBalance);
  }

  async closeRegister(registerId: string, closingBalance: number): Promise<CashRegister> {
    return closeCashRegister(registerId, closingBalance);
  }

  async getRegisterOrders(registerId: string): Promise<Order[]> {
    return getCashRegisterOrders(registerId);
  }

  async applyAdjustment(input: {
    registerId: string;
    type: "SUPPLY" | "WITHDRAWAL";
    amount: number;
    note?: string;
    actorId: string;
    actorRole: string;
  }): Promise<CashRegister> {
    return applyCashRegisterAdjustment(input);
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
