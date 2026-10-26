import { formatCurrency } from "@/lib/utils";
import { roundMoney } from "@/lib/money";

/**
 * When the store stops selling fiado to a client: a balance above the limit, or a purchase left
 * open for too long. Pure rules, shared by the checkout (which enforces them) and the POS (which
 * warns before the sale is sent).
 */

export interface FiadoPolicy {
  /** Most a client may owe after the sale, in reais. 0 = no limit. */
  limit: number;
  /** Days a fiado purchase may stay open before new fiado is refused. 0 = no limit. */
  maxDays: number;
}

export interface FiadoOrderLike {
  clientId?: string;
  isCancelled?: boolean;
  remainingAmount?: number;
  totalAmount?: number;
  paidAt?: unknown;
  createdAt?: unknown;
  paymentHistory?: Array<{ createdAt?: unknown }>;
}

export interface FiadoBlock {
  kind: "limit" | "overdue";
  message: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toFiadoPolicy(settings: { fiadoLimit?: unknown; fiadoMaxDays?: unknown }): FiadoPolicy {
  const limit = Number(settings.fiadoLimit);
  const maxDays = Math.floor(Number(settings.fiadoMaxDays));
  return {
    limit: Number.isFinite(limit) && limit > 0 ? roundMoney(limit) : 0,
    maxDays: Number.isFinite(maxDays) && maxDays > 0 ? maxDays : 0,
  };
}

/** A fiado sale that still has something to pay. */
export function isOpenFiadoOrder(order: FiadoOrderLike): boolean {
  if (order.isCancelled === true) return false;
  const remaining =
    typeof order.remainingAmount === "number" ? order.remainingAmount : order.paidAt ? 0 : Number(order.totalAmount || 0);
  return remaining >= 0.005;
}

/** When the oldest fiado purchase still open was made. */
export function oldestOpenFiadoAt(orders: FiadoOrderLike[]): Date | null {
  let oldest: Date | null = null;
  for (const order of orders) {
    if (!isOpenFiadoOrder(order)) continue;
    const at = toDate(order.createdAt);
    if (at && (!oldest || at < oldest)) oldest = at;
  }
  return oldest;
}

export function daysSince(date: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));
}

/** Why this fiado sale should not go through without an administrator; empty when it can. */
export function assessFiadoSale(input: {
  balance: number;
  oldestOpenAt: Date | null;
  saleTotal: number;
  policy: FiadoPolicy;
  now: Date;
}): FiadoBlock[] {
  const blocks: FiadoBlock[] = [];
  const { policy } = input;

  if (policy.maxDays > 0 && input.oldestOpenAt) {
    const days = daysSince(input.oldestOpenAt, input.now);
    if (days > policy.maxDays) {
      blocks.push({
        kind: "overdue",
        message: `Tem compra fiado em aberto há ${days} dias (o prazo é de ${policy.maxDays} dias).`,
      });
    }
  }

  if (policy.limit > 0) {
    const after = roundMoney(Math.max(0, Number(input.balance || 0)) + Math.max(0, Number(input.saleTotal || 0)));
    if (after > policy.limit + 0.004) {
      blocks.push({
        kind: "limit",
        message: `Com esta venda passa a dever ${formatCurrency(after)}, acima do limite de ${formatCurrency(policy.limit)}.`,
      });
    }
  }

  return blocks;
}
