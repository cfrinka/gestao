import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { cached } from "@/lib/server-cache";
import { roundMoney } from "@/lib/money";
import { addDaysISO, startOfStoreDay, todayISO } from "@/lib/dates";
import { toDate } from "@/domains/clients/fiado-credit";
import { differenceNeedsNote, expectedRegisterCash, registerCashDifference } from "@/domains/cash-register/register-difference";
import { getStoreSettingsCached } from "@/domains/settings/settings-db";

/**
 * How each operator's counts compared with what the drawer should have held. A difference is
 * counted minus expected: negative when cash was missing, positive when there was cash over.
 */

export interface RegisterLike {
  id: string;
  userId?: string;
  userName?: string;
  status?: string;
  openedAt?: unknown;
  closedAt?: unknown;
  openingBalance?: number;
  totalCash?: number;
  totalCashSupply?: number;
  totalCashWithdrawal?: number;
  closingBalance?: number | null;
  expectedCash?: number;
  cashDifference?: number;
  differenceNote?: string;
  /** Set only on registers closed by a data correction, with no count behind them. */
  closedBy?: string;
}

export interface ClosingLine {
  registerId: string;
  operatorId: string;
  operator: string;
  openedAt: string | null;
  closedAt: string | null;
  expected: number;
  counted: number;
  difference: number;
  note: string | null;
  aboveTolerance: boolean;
  /** Closed with nothing counted while the drawer should have held cash: the count was skipped. */
  notCounted: boolean;
}

export interface OperatorLine {
  operatorId: string;
  operator: string;
  closings: number;
  withDifference: number;
  aboveTolerance: number;
  /** Closings with no count at all: kept out of what was missing or over. */
  notCounted: number;
  /** Total cash missing, as a positive amount. */
  missing: number;
  /** Total cash over. */
  over: number;
  /** over − missing. */
  net: number;
  /** The largest single shortfall, as a positive amount. */
  worstMissing: number;
}

const DATA_FIX_CLOSER = "ajuste-de-dados";

export function computeRegisterDifferences(registers: RegisterLike[], tolerance: number) {
  const closings: ClosingLine[] = [];
  const byOperator = new Map<string, OperatorLine>();
  const totals = { closings: 0, withDifference: 0, aboveTolerance: 0, notCounted: 0, missing: 0, over: 0, net: 0 };

  for (const register of registers) {
    if (register.status !== "CLOSED" || register.closedBy === DATA_FIX_CLOSER) continue;
    const counted = Number(register.closingBalance);
    if (register.closingBalance === null || register.closingBalance === undefined || !Number.isFinite(counted)) continue;

    // Closings since the reason was introduced carry the figures the operator saw.
    const expected = typeof register.expectedCash === "number" ? register.expectedCash : expectedRegisterCash(register);
    const difference =
      typeof register.cashDifference === "number" ? register.cashDifference : registerCashDifference(register, counted);
    const hasDifference = Math.abs(difference) >= 0.01;
    // Zero counted against a drawer that should hold cash means the count was skipped, not that
    // all of it went missing; those closings are listed apart and stay out of the totals.
    const notCounted = counted < 0.005 && expected >= 0.01;
    const aboveTolerance = !notCounted && differenceNeedsNote(difference, tolerance);

    const operatorId = register.userId || register.userName || "?";
    const operator = register.userName?.trim() || "Sem nome";
    const line =
      byOperator.get(operatorId) ??
      { operatorId, operator, closings: 0, withDifference: 0, aboveTolerance: 0, notCounted: 0, missing: 0, over: 0, net: 0, worstMissing: 0 };
    line.closings += 1;
    totals.closings += 1;

    if (notCounted) {
      line.notCounted += 1;
      totals.notCounted += 1;
    } else if (hasDifference) {
      line.withDifference += 1;
      totals.withDifference += 1;
      if (aboveTolerance) {
        line.aboveTolerance += 1;
        totals.aboveTolerance += 1;
      }
      if (difference < 0) {
        line.missing = roundMoney(line.missing - difference);
        line.worstMissing = Math.max(line.worstMissing, roundMoney(-difference));
        totals.missing = roundMoney(totals.missing - difference);
      } else {
        line.over = roundMoney(line.over + difference);
        totals.over = roundMoney(totals.over + difference);
      }
      line.net = roundMoney(line.over - line.missing);
    }

    if (notCounted || hasDifference) {
      const openedAt = toDate(register.openedAt);
      const closedAt = toDate(register.closedAt);
      closings.push({
        registerId: register.id,
        operatorId,
        operator,
        openedAt: openedAt ? openedAt.toISOString() : null,
        closedAt: closedAt ? closedAt.toISOString() : null,
        expected,
        counted: roundMoney(counted),
        difference,
        note: register.differenceNote?.trim() || null,
        aboveTolerance,
        notCounted,
      });
    }
    byOperator.set(operatorId, line);
  }

  totals.net = roundMoney(totals.over - totals.missing);
  const operators = Array.from(byOperator.values()).sort(
    (a, b) => b.missing - a.missing || b.withDifference - a.withDifference || a.operator.localeCompare(b.operator, "pt-BR")
  );
  closings.sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)));

  return { operators, closings, totals, tolerance };
}

export function getRegisterDifferencesReport(periodDays: number) {
  const days = [30, 90, 180].includes(periodDays) ? periodDays : 90;
  return cached(`report-register-differences:${days}`, async () => {
    const start = startOfStoreDay(addDaysISO(todayISO(), -(days - 1)))!;
    const [snapshot, settings] = await Promise.all([
      adminDb.collection("cashRegisters").where("closedAt", ">=", Timestamp.fromDate(start)).get(),
      getStoreSettingsCached(),
    ]);
    const registers = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as RegisterLike);
    return { periodDays: days, ...computeRegisterDifferences(registers, Number(settings.registerDifferenceLimit ?? 10)) };
  });
}
