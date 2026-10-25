import { describe, expect, it } from "vitest";
import { normalizeCartItems, normalizePayments, settlePayments } from "./cart-validation";
import { HttpError } from "@/lib/api/http-errors";

describe("normalizeCartItems", () => {
  it("keeps valid lines and trims ids and sizes", () => {
    expect(normalizeCartItems([{ productId: " p1 ", size: " M ", quantity: 2 }])).toEqual([
      { productId: "p1", size: "M", quantity: 2 },
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN, "abc", 1000])("rejects quantity %p", (quantity) => {
    expect(() => normalizeCartItems([{ productId: "p1", size: "", quantity }])).toThrow(HttpError);
  });

  it("rejects an empty cart and a missing product id", () => {
    expect(() => normalizeCartItems([])).toThrow(HttpError);
    expect(() => normalizeCartItems([{ productId: "", quantity: 1 }])).toThrow(HttpError);
  });
});

describe("normalizePayments", () => {
  it("merges repeated methods, rounds to cents and drops zero lines", () => {
    expect(
      normalizePayments([
        { method: "DINHEIRO", amount: 10.004 },
        { method: "PIX", amount: 0 },
        { method: "DINHEIRO", amount: 5 },
      ])
    ).toEqual([{ method: "DINHEIRO", amount: 15 }]);
  });

  it("rejects unknown methods and negative amounts", () => {
    expect(() => normalizePayments([{ method: "FIADO", amount: 10 }])).toThrow(HttpError);
    expect(() => normalizePayments([{ method: "PIX", amount: -1 }])).toThrow(HttpError);
  });
});

describe("settlePayments", () => {
  it("records change out of the cash payment instead of counting it as received", () => {
    expect(settlePayments([{ method: "DINHEIRO", amount: 100 }], 80)).toEqual({
      payments: [{ method: "DINHEIRO", amount: 80 }],
      change: 20,
    });
  });

  it("takes change from cash when the sale is split with a card", () => {
    expect(
      settlePayments(
        [
          { method: "CREDITO", amount: 50 },
          { method: "DINHEIRO", amount: 50 },
        ],
        80
      )
    ).toEqual({
      payments: [
        { method: "CREDITO", amount: 50 },
        { method: "DINHEIRO", amount: 30 },
      ],
      change: 20,
    });
  });

  it("drops a cash line that was entirely change", () => {
    expect(
      settlePayments(
        [
          { method: "PIX", amount: 80 },
          { method: "DINHEIRO", amount: 20 },
        ],
        80
      )
    ).toEqual({ payments: [{ method: "PIX", amount: 80 }], change: 20 });
  });

  it("refuses an overpayment that cash cannot cover as change", () => {
    expect(() => settlePayments([{ method: "CREDITO", amount: 100 }], 80)).toThrow(HttpError);
  });

  it("refuses a payment short of the total", () => {
    expect(() => settlePayments([{ method: "DINHEIRO", amount: 70 }], 80)).toThrow(HttpError);
  });

  it("tolerates the one-cent PIX rounding drift in either direction", () => {
    expect(settlePayments([{ method: "PIX", amount: 95.25 }], 95.24).change).toBe(0);
    expect(settlePayments([{ method: "PIX", amount: 95.23 }], 95.24).change).toBe(0);
  });
});
