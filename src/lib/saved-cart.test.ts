import { beforeEach, describe, expect, it } from "vitest";
import { readSavedCarts, restoreCartLines, writeSavedCarts, type SavedCart } from "./saved-cart";

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

const cart = (id: string, number: number, lines: SavedCart["lines"], name = ""): SavedCart => ({ id, number, name, lines });

describe("saved carts", () => {
  const now = Date.UTC(2026, 9, 26, 15);

  it("keeps every open cart of a user, and which one was on screen", () => {
    writeSavedCarts(
      "ana",
      [cart("c1", 1, [{ productId: "p1", size: "M", quantity: 2 }]), cart("c2", 2, [{ productId: "p2", size: "", quantity: 1 }], "Maria")],
      "c2",
      now
    );
    const saved = readSavedCarts("ana", now);
    expect(saved.activeId).toBe("c2");
    expect(saved.carts.map((c) => [c.id, c.number, c.name, c.lines.length])).toEqual([
      ["c1", 1, "", 1],
      ["c2", 2, "Maria", 1],
    ]);
    expect(readSavedCarts("bia", now).carts).toEqual([]);
  });

  it("drops empty unnamed carts and forgets everything when no cart has pieces", () => {
    writeSavedCarts("ana", [cart("c1", 1, [{ productId: "p1", size: "", quantity: 1 }]), cart("c2", 2, [])], "c1", now);
    expect(readSavedCarts("ana", now).carts.map((c) => c.id)).toEqual(["c1"]);

    writeSavedCarts("ana", [cart("c1", 1, [], "Maria")], "c1", now);
    expect(readSavedCarts("ana", now).carts).toEqual([]);
  });

  it("reads a single cart saved before there could be several", () => {
    localStorage.setItem("pos-cart:ana", JSON.stringify({ savedAt: now, lines: [{ productId: "p1", size: "M", quantity: 1 }] }));
    expect(readSavedCarts("ana", now)).toEqual({ carts: [cart("cart-1", 1, [{ productId: "p1", size: "M", quantity: 1 }])], activeId: "cart-1" });
  });

  it("lets carts older than 12 hours go, and ignores what it cannot read", () => {
    writeSavedCarts("ana", [cart("c1", 1, [{ productId: "p1", size: "", quantity: 1 }])], "c1", now);
    expect(readSavedCarts("ana", now + 11 * 3600_000).carts).toHaveLength(1);
    expect(readSavedCarts("ana", now + 13 * 3600_000).carts).toEqual([]);
    localStorage.setItem("pos-cart:ana", "{not json");
    expect(readSavedCarts("ana", now).carts).toEqual([]);
  });

  it("rebuilds from the current catalogue, trimming to the stock there is now", () => {
    const products = [
      { id: "p1", name: "Vestido", stock: 3, sizes: [{ size: "M", stock: 1 }, { size: "G", stock: 2 }] },
      { id: "p2", name: "Cinto", stock: 5, sizes: [] },
    ];
    const { cart: restored, dropped } = restoreCartLines(
      [
        { productId: "p1", size: "M", quantity: 2 }, // only 1 left
        { productId: "p1", size: "P", quantity: 1 }, // size not in stock
        { productId: "p2", size: "", quantity: 2 },
        { productId: "gone", size: "", quantity: 1 },
      ],
      products
    );
    expect(restored.map((line) => [line.product.id, line.size, line.quantity])).toEqual([
      ["p1", "M", 1],
      ["p2", "", 2],
    ]);
    expect(restored[0].product).toBe(products[0]);
    expect(dropped).toBe(3);
  });

  it("never gives two carts the same last piece", () => {
    const products = [{ id: "p1", name: "Vestido", stock: 1, sizes: [{ size: "M", stock: 1 }] }];
    const held = new Map<string, number>();
    const first = restoreCartLines([{ productId: "p1", size: "M", quantity: 1 }], products, held);
    const second = restoreCartLines([{ productId: "p1", size: "M", quantity: 1 }], products, held);
    expect(first.cart).toHaveLength(1);
    expect(second).toEqual({ cart: [], dropped: 1 });
  });
});
