import { describe, expect, it } from "vitest";
import { cashEffect } from "./cash-effect";

describe("cashEffect", () => {
  it("counts a paid sale as cash in, a fiado sale only when it is paid", () => {
    expect(cashEffect({ type: "SALE_REVENUE", direction: "IN", amount: 100 })).toEqual({ cashIn: 100, cashOut: 0 });
    expect(cashEffect({ type: "SALE_REVENUE", direction: "IN", amount: 100, metadata: { isPaidLater: true } })).toEqual({
      cashIn: 0,
      cashOut: 0,
    });
    expect(cashEffect({ type: "FIADO_PAYMENT", direction: "IN", amount: 40 })).toEqual({ cashIn: 40, cashOut: 0 });
  });

  it("counts goods once on the way out: when bought, not again as cost of each sale", () => {
    expect(cashEffect({ type: "STOCK_PURCHASE", direction: "OUT", amount: 300 })).toEqual({ cashIn: 0, cashOut: 300 });
    expect(cashEffect({ type: "COGS", direction: "OUT", amount: 50 })).toEqual({ cashIn: 0, cashOut: 0 });
  });

  it("treats bills and exchange refunds as money out and exchange differences as money in", () => {
    expect(cashEffect({ type: "OPERATING_EXPENSE", direction: "OUT", amount: 80 }).cashOut).toBe(80);
    expect(cashEffect({ type: "EXCHANGE_REFUND", direction: "OUT", amount: 20 }).cashOut).toBe(20);
    expect(cashEffect({ type: "EXCHANGE_DIFFERENCE", direction: "IN", amount: 15 }).cashIn).toBe(15);
  });

  it("ignores zeroed movements (cancelled sales)", () => {
    expect(cashEffect({ type: "SALE_REVENUE", direction: "IN", amount: 0 })).toEqual({ cashIn: 0, cashOut: 0 });
  });
});
