import { beforeEach, describe, expect, it } from "vitest";
import { readSavedCart, restoreCartLines, writeSavedCart } from "./saved-cart";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

describe("saved cart", () => {
  const now = Date.UTC(2026, 9, 26, 15);

  it("keeps each user's cart apart and forgets it when emptied", () => {
    writeSavedCart("ana", [{ productId: "p1", size: "M", quantity: 2 }], now);
    expect(readSavedCart("ana", now)).toEqual([{ productId: "p1", size: "M", quantity: 2 }]);
    expect(readSavedCart("bia", now)).toEqual([]);

    writeSavedCart("ana", [], now);
    expect(readSavedCart("ana", now)).toEqual([]);
  });

  it("lets a cart older than 12 hours go", () => {
    writeSavedCart("ana", [{ productId: "p1", size: "", quantity: 1 }], now);
    expect(readSavedCart("ana", now + 11 * 3600_000)).toHaveLength(1);
    expect(readSavedCart("ana", now + 13 * 3600_000)).toEqual([]);
  });

  it("ignores what it cannot read", () => {
    localStorage.setItem("pos-cart:ana", "{not json");
    expect(readSavedCart("ana", now)).toEqual([]);
  });

  it("rebuilds from the current catalogue, trimming to the stock there is now", () => {
    const products = [
      { id: "p1", name: "Vestido", stock: 3, sizes: [{ size: "M", stock: 1 }, { size: "G", stock: 2 }] },
      { id: "p2", name: "Cinto", stock: 5, sizes: [] },
    ];
    const { cart, dropped } = restoreCartLines(
      [
        { productId: "p1", size: "M", quantity: 2 }, // only 1 left
        { productId: "p1", size: "P", quantity: 1 }, // size not in stock
        { productId: "p2", size: "", quantity: 2 },
        { productId: "gone", size: "", quantity: 1 },
      ],
      products
    );
    expect(cart.map((line) => [line.product.id, line.size, line.quantity])).toEqual([
      ["p1", "M", 1],
      ["p2", "", 2],
    ]);
    expect(cart[0].product).toBe(products[0]);
    expect(dropped).toBe(3);
  });
});
