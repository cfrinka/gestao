import { roundMoney } from "@/lib/money";

/**
 * What a closing count is compared against. Cash sales, fiado received in cash and exchange
 * differences are already in totalCash (cash refunds already taken out of it); change added and
 * withdrawals are the drawer's own movements.
 */
export interface RegisterCashTotals {
  openingBalance?: number | null;
  totalCash?: number | null;
  totalCashSupply?: number | null;
  totalCashWithdrawal?: number | null;
}

export function expectedRegisterCash(register: RegisterCashTotals): number {
  return roundMoney(
    Number(register.openingBalance || 0) +
      Number(register.totalCash || 0) +
      Number(register.totalCashSupply || 0) -
      Number(register.totalCashWithdrawal || 0)
  );
}

/** Counted minus expected: negative is cash missing, positive is cash over. */
export function registerCashDifference(register: RegisterCashTotals, counted: number): number {
  return roundMoney(Number(counted || 0) - expectedRegisterCash(register));
}

/** A difference above the store's tolerance needs a written reason before the register closes. */
export function differenceNeedsNote(difference: number, tolerance: number): boolean {
  return Math.abs(difference) > Math.max(0, Number(tolerance || 0)) + 0.004;
}
