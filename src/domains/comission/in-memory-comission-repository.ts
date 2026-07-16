import type { Order, UserRecord } from "@/lib/db-types";
import type { CommissionRepository } from "@/domains/comission/repository";
import type { CommissionMonth, SyncResult, UserCommission } from "@/domains/comission/types";

// Same flat rate the real Firestore implementation uses — see COMMISSION_RATE in
// @/domains/comission/comission-db.ts (getCommissionReport), applied there via
// `Math.round(totalSales * COMMISSION_RATE * 100) / 100` per user per competency month.
const COMMISSION_RATE = 0.03;

function toCompetencyMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * The `Order` type in @/lib/db-types does not declare a `createdById` (or similar) field,
 * even though the real Firestore documents carry one (checkout-db.ts writes `createdById`
 * on every order it creates) and comission-db.ts's real getCommissionReport() attributes
 * sales to a salesperson via that field on the underlying document. Until some other
 * in-memory writer (checkout domain) starts stamping `createdById` on the `Order` objects it
 * puts into the shared `orders` Map, this repository has no reliable way to attribute a sale
 * to a user — we read the field defensively through this loosely-typed view and fall back to
 * an "unknown" bucket instead of crashing or attributing sales to the wrong person.
 */
type OrderWithAttribution = Order & { createdById?: string };

/**
 * Demo-mode commission repository: aggregates sales directly from the shared `orders` Map
 * instead of a separate financialMovements ledger (which doesn't exist in demo mode). Since
 * repositories are constructed fresh per request but must observe the same session data, this
 * class takes the shared Maps as constructor parameters rather than owning private copies.
 */
export class InMemoryCommissionRepository implements CommissionRepository {
  constructor(
    private orders: Map<string, Order>,
    private users: Map<string, UserRecord>
  ) {}

  async syncMovements(): Promise<SyncResult> {
    // The real syncMovements() reconciles a separate `financialMovements` ledger against
    // `orders` in Firestore. Demo mode has no such ledger — getCommissionReport() below reads
    // straight from the shared `orders` Map, so there is nothing to backfill or fix. No-op.
    return { synced: 0, fixed: 0, message: "Nada a sincronizar (modo demonstração)." };
  }

  async getCommissionReport(targetUserId: string | null): Promise<UserCommission[]> {
    // userId -> competencyMonth -> total sales amount
    // NOTE: uses Map#forEach (a callback, not `for...of`/spread) throughout this method
    // because this project's tsconfig has no explicit `target`/`downlevelIteration`, under
    // which `for...of` (and Array.from()) over a Map's iterators fails to type-check (TS2802).
    const salesByUserMonth = new Map<string, Map<string, number>>();

    this.orders.forEach((order) => {
      if (order.isCancelled) return;

      const userId = (order as OrderWithAttribution).createdById || "unknown";
      if (targetUserId && userId !== targetUserId) return;

      const month = toCompetencyMonth(new Date(order.createdAt));
      const amount = Number(order.totalAmount || 0);

      let monthMap = salesByUserMonth.get(userId);
      if (!monthMap) {
        monthMap = new Map();
        salesByUserMonth.set(userId, monthMap);
      }
      monthMap.set(month, (monthMap.get(month) || 0) + amount);
    });

    const result: UserCommission[] = [];

    salesByUserMonth.forEach((monthMap, userId) => {
      const userInfo = this.users.get(userId);

      const monthEntries: [string, number][] = [];
      monthMap.forEach((totalSales, month) => monthEntries.push([month, totalSales]));

      const months: CommissionMonth[] = monthEntries
        .sort((a, b) => b[0].localeCompare(a[0])) // descending month
        .map(([month, totalSales]) => ({
          month,
          totalSales,
          commission: Math.round(totalSales * COMMISSION_RATE * 100) / 100,
        }));

      const totalSalesOverall = months.reduce((sum, m) => sum + m.totalSales, 0);
      const totalCommission = months.reduce((sum, m) => sum + m.commission, 0);

      result.push({
        userId,
        userName: userInfo?.name || userId,
        role: userInfo?.role || "CASHIER",
        months,
        totalSalesOverall,
        totalCommission,
      });
    });

    result.sort((a, b) => b.totalSalesOverall - a.totalSalesOverall);

    return result;
  }
}
