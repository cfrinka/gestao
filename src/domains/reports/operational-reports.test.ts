import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase-admin", () => ({ adminDb: {} }));
vi.mock("@/domains/products/products-db", () => ({ getProductsCached: vi.fn() }));
vi.mock("@/domains/clients/clients-db", () => ({ getClients: vi.fn() }));

import {
  compareSizes,
  computeFiadoCollection,
  computeSizesAndRestock,
  computeStagnantStock,
  whatsappNumber,
} from "./operational-reports";
import type { Client, Product } from "@/lib/db-types";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-26T15:00:00.000Z");

function product(overrides: Partial<Product>): Product {
  return {
    id: "p1",
    name: "Vestido",
    sku: "V1",
    plusSized: false,
    costPrice: 40,
    salePrice: 100,
    stock: 0,
    sizes: [],
    createdAt: new Date(now.getTime() - 300 * DAY),
    updatedAt: now,
    ...overrides,
  } as Product;
}

describe("compareSizes", () => {
  it("orders letter grids, plus sizes and numbers the way the store prints them", () => {
    expect(["G", "38", "P", "GG", "TU", "G1", "M", "36"].sort(compareSizes)).toEqual(["TU", "P", "M", "G", "GG", "G1", "36", "38"]);
  });
});

describe("computeSizesAndRestock", () => {
  const products = [
    product({ id: "p1", sizes: [{ size: "P", stock: 0 }, { size: "M", stock: 1 }, { size: "G", stock: 20 }], stock: 21 }),
    product({ id: "p2", name: "Bolsa", sizes: [], stock: 5 }),
  ];
  const at = now;
  const lines = [
    { productId: "p1", size: "P", quantity: 3, at },
    { productId: "p1", size: "M", quantity: 6, at },
    { productId: "p1", size: "G", quantity: 2, at },
    { productId: "p2", size: "", quantity: 1, at },
  ];

  it("sums sales and stock per size, with how much of each size sold", () => {
    const { bySize, piecesSold } = computeSizesAndRestock(lines, products, 30);
    expect(piecesSold).toBe(12);
    expect(bySize.map((s) => s.size)).toEqual(["P", "M", "G", "Único"]);
    const m = bySize.find((s) => s.size === "M")!;
    expect(m).toMatchObject({ sold: 6, stock: 1 });
    expect(m.sellThrough).toBeCloseTo(6 / 7);
  });

  it("lists sold-out and running-out sizes first, and leaves well-stocked ones out", () => {
    const { restock } = computeSizesAndRestock(lines, products, 30);
    expect(restock.map((r) => `${r.productId}:${r.size}:${r.urgency}`)).toEqual(["p1:P:esgotado", "p1:M:acabando"]);
    // 6 sold in 30 days → 6 needed for the next 30, 1 in stock → buy 5.
    expect(restock.find((r) => r.size === "M")?.suggested).toBe(5);
  });
});

describe("computeStagnantStock", () => {
  it("measures days since the last sale and groups the money tied up", () => {
    const products = [
      product({ id: "old", stock: 3, costPrice: 50 }),
      product({ id: "slow", stock: 2, costPrice: 30 }),
      product({ id: "fresh", stock: 4, createdAt: new Date(now.getTime() - 10 * DAY) }),
      product({ id: "selling", stock: 1 }),
      product({ id: "empty", stock: 0 }),
    ];
    const lastSale = new Map([
      ["slow", new Date(now.getTime() - 65 * DAY)],
      ["selling", new Date(now.getTime() - 3 * DAY)],
    ]);
    const { lines, buckets } = computeStagnantStock(products, lastSale, now, 180);

    expect(lines.map((l) => l.productId)).toEqual(["old", "slow"]);
    expect(lines[0]).toMatchObject({ days: 180, noSaleInWindow: true, costValue: 150 });
    expect(lines[1]).toMatchObject({ days: 65, noSaleInWindow: false });
    expect(buckets.d90).toMatchObject({ products: 1, pieces: 3, costValue: 150 });
    expect(buckets.d60).toMatchObject({ products: 1, pieces: 2, costValue: 60 });
  });
});

describe("computeFiadoCollection", () => {
  const clients: Client[] = [
    { id: "c1", name: "Ana", phone: "(11) 98765-4321", balance: 150, createdAt: now, updatedAt: now },
    { id: "c2", name: "Bia", phone: "", balance: 40, createdAt: now, updatedAt: now },
    { id: "c3", name: "Caio", balance: 0, createdAt: now, updatedAt: now },
  ];
  const orders = [
    { clientId: "c1", remainingAmount: 100, createdAt: new Date(now.getTime() - 95 * DAY), paymentHistory: [{ createdAt: new Date(now.getTime() - 20 * DAY) }] },
    { clientId: "c1", remainingAmount: 50, createdAt: new Date(now.getTime() - 10 * DAY) },
    { clientId: "c1", remainingAmount: 0, createdAt: new Date(now.getTime() - 200 * DAY) },
    { clientId: "c2", remainingAmount: 40, createdAt: new Date(now.getTime() - 5 * DAY), isCancelled: false },
  ];

  it("lists only clients who owe, oldest debt first, with a WhatsApp number when possible", () => {
    const { lines, totals } = computeFiadoCollection(clients, orders, now);
    expect(lines.map((l) => l.name)).toEqual(["Ana", "Bia"]);
    expect(lines[0]).toMatchObject({ owed: 150, openPurchases: 2, daysOpen: 95, whatsapp: "5511987654321" });
    expect(lines[0].lastPaymentAt).not.toBeNull();
    expect(lines[1]).toMatchObject({ whatsapp: null, lastPaymentAt: null });
    expect(totals).toEqual({ owed: 190, clients: 2, over60: 150, over90: 150 });
  });

  it("reads Brazilian phone formats", () => {
    expect(whatsappNumber("11 3333-4444")).toBe("551133334444");
    expect(whatsappNumber("+55 (21) 99999-0000")).toBe("5521999990000");
    expect(whatsappNumber("123")).toBeNull();
  });
});
