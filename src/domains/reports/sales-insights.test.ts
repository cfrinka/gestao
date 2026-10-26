import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase-admin", () => ({ adminDb: {} }));
vi.mock("@/domains/products/products-db", () => ({ getProductsCached: vi.fn() }));
vi.mock("@/domains/clients/clients-db", () => ({ getClients: vi.fn() }));

import type { Client, Product } from "@/lib/db-types";
import { computeExchangeInsights, computeSalesInsights, storeWeekdayHour, type InsightOrder } from "./sales-insights";

// 2026-10-26 is a Monday; 15:00 UTC is 12:00 in São Paulo.
const at = (day: number, hourSP: number) => new Date(Date.UTC(2026, 9, day, hourSP + 3));

const products = [
  { id: "p1", name: "Vestido", sku: "V1", category: "Vestidos" },
  { id: "p2", name: "Blusa", sku: "B1", category: "Blusas" },
  { id: "p3", name: "Meia", sku: "M1" },
] as Product[];

const order = (id: string, overrides: Partial<InsightOrder>): InsightOrder => ({
  id,
  subtotal: 100,
  discount: 0,
  totalAmount: 100,
  createdAt: at(26, 10),
  createdById: "u1",
  createdByName: "Ana",
  ...overrides,
});

describe("storeWeekdayHour", () => {
  it("reads the weekday and hour on the store's clock, Monday first", () => {
    expect(storeWeekdayHour(at(26, 10))).toEqual({ weekday: 0, hour: 10 });
    expect(storeWeekdayHour(new Date("2026-10-26T02:30:00.000Z"))).toEqual({ weekday: 6, hour: 23 }); // still Sunday in SP
  });
});

describe("computeSalesInsights", () => {
  const orders = [
    order("o1", { createdAt: at(26, 10), subtotal: 200, discount: 20, totalAmount: 180, promoDiscount: 20, manualDiscount: 0, customerPhone: "(11) 98765-4321" }),
    order("o2", { createdAt: at(26, 10), subtotal: 100, discount: 0, totalAmount: 100, createdById: "u2", createdByName: "Bia" }),
    order("o3", { createdAt: at(31, 15), subtotal: 100, discount: 50, totalAmount: 50, customerPhone: "11987654321" }),
    order("x", { isCancelled: true, totalAmount: 999 }),
  ];
  const items = [
    { orderId: "o1", productId: "p1", quantity: 2, totalRevenue: 200, totalCost: 80 },
    { orderId: "o2", productId: "p2", quantity: 1, totalRevenue: 100, totalCost: 40 },
    { orderId: "o3", productId: "p3", quantity: 1, totalRevenue: 100, totalCost: 30 },
    { orderId: "x", productId: "p1", quantity: 5, totalRevenue: 500, totalCost: 200 },
  ];
  const clients = [{ id: "c1", name: "Carla", phone: "(11) 98765-4321", balance: 0 } as Client];
  const result = computeSalesInsights({ orders, items, products, clients });

  it("totals the sales that stand, leaving cancelled ones out", () => {
    expect(result.totals).toEqual({ sales: 3, revenue: 330, pieces: 4, gross: 400, discount: 70, avgTicket: 110, piecesPerSale: 1.3 });
  });

  it("places each sale on its weekday and hour", () => {
    const { hours, days, busiestDay, maxCellSales } = result.heatmap;
    expect(hours).toEqual([10, 11, 12, 13, 14, 15]);
    expect(days[0].cells[0]).toEqual({ hour: 10, sales: 2, revenue: 280 });
    expect(days[5].cells[5]).toEqual({ hour: 15, sales: 1, revenue: 50 }); // 31/10 is a Saturday
    expect(maxCellSales).toBe(2);
    expect(busiestDay?.label).toBe("Seg");
  });

  it("measures each seller's ticket, pieces per sale and discount", () => {
    expect(result.sellers[0]).toMatchObject({ name: "Ana", sales: 2, revenue: 230, pieces: 3, avgTicket: 115, piecesPerSale: 1.5, discount: 70 });
    expect(result.sellers[0].discountShare).toBeCloseTo(70 / 300);
  });

  it("splits discounts by size and by who gave them", () => {
    expect(result.discounts).toMatchObject({ discount: 70, salesWithDiscount: 2, promo: 20, manual: 0, unsplit: 50 });
    expect(result.discounts.bands.map((band) => band.sales)).toEqual([1, 1, 0, 0, 1]);
  });

  it("credits each category with what its pieces really brought in after discounts", () => {
    const byName = Object.fromEntries(result.categories.map((c) => [c.category, c]));
    expect(byName.Vestidos).toMatchObject({ pieces: 2, revenue: 180, cost: 80, margin: 100 });
    expect(byName["Sem categoria"]).toMatchObject({ revenue: 50, margin: 20 });
    expect(result.categories[0].category).toBe("Vestidos");
  });

  it("recognises a returning customer by phone, whatever the format, and names known clients", () => {
    expect(result.customers).toMatchObject({ salesWithPhone: 2, identified: 1, returning: 1 });
    expect(result.customers.top[0]).toMatchObject({ name: "Carla", sales: 2, revenue: 230 });
  });
});

describe("computeExchangeInsights", () => {
  it("counts returned pieces per product and size swaps of the same product", () => {
    const result = computeExchangeInsights(
      [
        {
          items: [
            { productId: "p1", size: "M", quantity: 1, direction: "IN" },
            { productId: "p1", size: "G", quantity: 1, direction: "OUT" },
          ],
        },
        {
          items: [
            { productId: "p1", size: "M", quantity: 1, direction: "IN" },
            { productId: "p2", size: "P", quantity: 1, direction: "OUT" },
          ],
        },
      ],
      products
    );
    expect(result).toMatchObject({ count: 2, piecesIn: 2, piecesOut: 2 });
    expect(result.products[0]).toMatchObject({ productId: "p1", piecesIn: 2, exchanges: 2, sizeSwaps: 1, sizesIn: [{ size: "M", pieces: 2 }] });
    expect(result.sizeSwaps).toEqual([{ from: "M", to: "G", count: 1 }]);
  });
});
