import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase-admin", () => ({ adminDb: {} }));
vi.mock("@/domains/settings/settings-db", () => ({ getStoreSettingsCached: vi.fn() }));

import { computeRegisterDifferences, type RegisterLike } from "./register-differences";

const closed = (overrides: Partial<RegisterLike>): RegisterLike => ({
  id: "r",
  userId: "u1",
  userName: "Sofia",
  status: "CLOSED",
  openedAt: new Date("2026-10-20T12:00:00.000Z"),
  closedAt: new Date("2026-10-20T22:00:00.000Z"),
  openingBalance: 100,
  totalCash: 200,
  totalCashSupply: 0,
  totalCashWithdrawal: 50,
  closingBalance: 250,
  ...overrides,
});

describe("computeRegisterDifferences", () => {
  it("totals each operator's shortfalls and surpluses, worst operator first", () => {
    const { operators, closings, totals } = computeRegisterDifferences(
      [
        closed({ id: "a", closingBalance: 250 }), // exact
        closed({ id: "b", closingBalance: 90, totalCash: 0, totalCashWithdrawal: 0, closedAt: new Date("2026-10-21T22:00:00.000Z") }), // −10
        closed({ id: "c", closingBalance: 255 }), // +5
        closed({ id: "d", userId: "u2", userName: "Carlos", closingBalance: 100 }), // −150
      ],
      10
    );

    expect(operators.map((o) => o.operator)).toEqual(["Carlos", "Sofia"]);
    expect(operators[1]).toMatchObject({ closings: 3, withDifference: 2, aboveTolerance: 0, missing: 10, over: 5, net: -5, worstMissing: 10 });
    expect(operators[0]).toMatchObject({ closings: 1, missing: 150, aboveTolerance: 1 });
    expect(closings.map((c) => c.registerId)).toEqual(["b", "c", "d"]); // newest closing first
    expect(totals).toEqual({ closings: 4, withDifference: 3, aboveTolerance: 1, notCounted: 0, missing: 160, over: 5, net: -155 });
  });

  it("lists a closing with nothing counted apart, out of what was missing", () => {
    const { operators, closings, totals } = computeRegisterDifferences([closed({ id: "z", closingBalance: 0 })], 10);
    expect(totals).toMatchObject({ closings: 1, notCounted: 1, withDifference: 0, missing: 0, aboveTolerance: 0 });
    expect(operators[0]).toMatchObject({ notCounted: 1, missing: 0 });
    expect(closings[0]).toMatchObject({ registerId: "z", notCounted: true, aboveTolerance: false });
  });

  it("reads the figures frozen at closing and the reason given", () => {
    const { closings } = computeRegisterDifferences(
      [closed({ closingBalance: 230, expectedCash: 260, cashDifference: -30, differenceNote: "Troco errado" })],
      10
    );
    expect(closings[0]).toMatchObject({ expected: 260, difference: -30, note: "Troco errado", aboveTolerance: true });
  });

  it("leaves out open registers and closings a data correction made without a count", () => {
    const { totals } = computeRegisterDifferences(
      [
        closed({ status: "OPEN", closingBalance: null }),
        closed({ closedBy: "ajuste-de-dados", closingBalance: 0 }),
        closed({ closingBalance: null }),
      ],
      10
    );
    expect(totals.closings).toBe(0);
  });
});
