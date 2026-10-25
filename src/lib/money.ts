/**
 * Money is stored as reais with two decimals. Percent discounts and PIX math produce values
 * like 95.238; every amount that is saved, summed into a register or compared against a
 * balance goes through roundMoney first so no fraction of a cent is ever left behind.
 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Anything smaller than half a cent is zero (legacy unrounded data can leave 0.004 behind). */
export function isZeroMoney(value: number): boolean {
  return Math.abs(Number(value) || 0) < 0.005;
}

export function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(roundMoney(value));
}
