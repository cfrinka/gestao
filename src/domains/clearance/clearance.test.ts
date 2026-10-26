import { describe, expect, it } from "vitest";
import type { Product } from "@/lib/db-types";
import {
  computeClearanceCandidates,
  describeClearances,
  niceDown,
  niceUp,
  percentForPrice,
  priceForPercent,
  suggestClearancePrice,
} from "./clearance";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-26T15:00:00.000Z");
const today = "2026-10-26";

function product(overrides: Partial<Product>): Product {
  return {
    id: "p1",
    name: "Vestido",
    sku: "V1",
    costPrice: 30,
    salePrice: 79.99,
    stock: 3,
    sizes: [],
    createdAt: new Date(now.getTime() - 200 * DAY),
    updatedAt: now,
    ...overrides,
  } as Product;
}

const noDiscounts = { productDiscountsEnabled: false, productDiscounts: [] };

describe("clearance prices", () => {
  it("rounds to prices ending in ,90", () => {
    expect(niceDown(47.99)).toBe(47.9);
    expect(niceDown(47.9)).toBe(47.9);
    expect(niceDown(47.89)).toBe(46.9);
    expect(niceUp(36)).toBe(36.9);
    expect(niceUp(36.9)).toBe(36.9);
  });

  it("lands exactly on the chosen price through the stored percentage", () => {
    for (const [sale, price] of [[59.99, 39.9], [79.99, 47.9], [129.9, 89.9], [25, 19.9]]) {
      expect(priceForPercent(sale, percentForPrice(sale, price))).toBe(price);
    }
  });

  it("cuts deeper the longer it went without selling", () => {
    expect(suggestClearancePrice(100, 20, 35)).toEqual({ price: 79.9, percent: 20.1 });
    expect(suggestClearancePrice(100, 20, 70)?.price).toBe(69.9);
    expect(suggestClearancePrice(100, 20, 120)?.price).toBe(59.9);
    expect(suggestClearancePrice(100, 20, 400)?.price).toBe(49.9);
  });

  it("never suggests below cost plus 20%, and none when there is no room", () => {
    expect(suggestClearancePrice(100, 60, 400)?.price).toBe(72.9);
    expect(suggestClearancePrice(50, 45, 400)).toBeNull();
  });
});

describe("computeClearanceCandidates", () => {
  const options = { now, today, windowDays: 30, lookbackDays: 365, discounts: noDiscounts };

  it("lists products in stock with no sale in the window, longest stopped first", () => {
    const products = [
      product({ id: "sold-recently" }),
      product({ id: "stopped-45" }),
      product({ id: "never-sold" }),
      product({ id: "out-of-stock", stock: 0 }),
    ];
    const lastSale = new Map([
      ["sold-recently", new Date(now.getTime() - 5 * DAY)],
      ["stopped-45", new Date(now.getTime() - 45 * DAY)],
    ]);
    const { candidates, totals, newArrivals } = computeClearanceCandidates(products, lastSale, options);

    expect(candidates.map((c) => c.productId)).toEqual(["never-sold", "stopped-45"]);
    // 200 days → 50% off 79,99 = 39,99 → 39,90, still above cost + 20% (36,90).
    expect(candidates[0]).toMatchObject({ daysWithoutSale: 200, noSaleInLookback: true, suggestedPrice: 39.9 });
    expect(candidates[1]).toMatchObject({ daysWithoutSale: 45, noSaleInLookback: false, suggestedPrice: 63.9 });
    expect(totals).toEqual({ products: 2, pieces: 6, costValue: 180, saleValue: 479.94 });
    expect(newArrivals).toBe(0);
  });

  it("leaves out products registered inside the window: they are new, not stopped", () => {
    const { candidates, newArrivals } = computeClearanceCandidates(
      [product({ createdAt: new Date(now.getTime() - 10 * DAY) })],
      new Map(),
      options
    );
    expect(candidates).toHaveLength(0);
    expect(newArrivals).toBe(1);
  });

  it("shows the discount already running on a product", () => {
    const { candidates } = computeClearanceCandidates([product({})], new Map(), {
      ...options,
      discounts: {
        productDiscountsEnabled: true,
        productDiscounts: [{ productId: "p1", discountPercent: percentForPrice(79.99, 59.9), endsAt: "2026-11-09" }],
      },
    });
    expect(candidates[0].current).toEqual({ discountPercent: percentForPrice(79.99, 59.9), price: 59.9, endsAt: "2026-11-09" });
  });
});

describe("describeClearances", () => {
  const startOfDay = (iso: string) => new Date(`${iso}T03:00:00.000Z`);

  it("counts pieces sold since each clearance started and reads its status from the dates", () => {
    const lines = [
      { productId: "p1", quantity: 2, at: new Date("2026-10-20T15:00:00.000Z") },
      { productId: "p1", quantity: 1, at: new Date("2026-10-10T15:00:00.000Z") },
    ];
    const result = describeClearances(
      [
        { productId: "p1", discountPercent: 25, startsAt: "2026-10-15", endsAt: "2026-10-31", source: "clearance" },
        { productId: "p2", discountPercent: 10, startsAt: "2026-10-01", endsAt: "2026-10-20" },
        { productId: "gone", discountPercent: 10 },
      ],
      [product({ id: "p1", salePrice: 100 }), product({ id: "p2", name: "Blusa", salePrice: 50 })],
      lines,
      today,
      startOfDay
    );
    expect(result.map((r) => [r.productId, r.status, r.soldSinceStart, r.price])).toEqual([
      ["p1", "ativa", 2, 75],
      ["p2", "encerrada", 0, 45],
    ]);
  });
});
