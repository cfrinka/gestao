import type { CashRegister, Order } from "@/lib/db-types";
import type { IdempotencyReservation } from "@/domains/cash-register/types";

export interface CashRegisterRepository {
  getOpenRegister(userId: string): Promise<CashRegister | null>;
  openRegister(userId: string, userName: string, openingBalance: number): Promise<CashRegister>;
  closeRegister(registerId: string, closingBalance: number): Promise<CashRegister>;
  getRegisterOrders(registerId: string): Promise<Order[]>;
  applyAdjustment(input: {
    registerId: string;
    type: "SUPPLY" | "WITHDRAWAL";
    amount: number;
    note?: string;
    actorId: string;
    actorRole: string;
  }): Promise<CashRegister>;

  reserveIdempotency(input: { ownerId: string; idempotencyKey: string; requestHash: string }): Promise<IdempotencyReservation>;
  markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }): Promise<void>;
  markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }): Promise<void>;
}
