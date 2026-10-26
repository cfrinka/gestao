import { describe, expect, it } from "vitest";
import { applyStockEdit, parseStockEdit, requestedStockDelta } from "./stock-edit";

describe("applyStockEdit", () => {
  it("keeps a sale made while the form was open", () => {
    // Form loaded M=3, admin adds 2 → saves M=5. Meanwhile one M was sold (now 2).
    const result = applyStockEdit(
      { stock: 2, sizes: [{ size: "M", stock: 2 }] },
      { baseStock: 3, baseSizes: [{ size: "M", stock: 3 }], stock: 5, sizes: [{ size: "M", stock: 5 }] }
    );
    expect(result.sizes).toEqual([{ size: "M", stock: 4 }]);
    expect(result.stock).toBe(4);
  });

  it("leaves untouched sizes exactly as they are now", () => {
    const result = applyStockEdit(
      { stock: 3, sizes: [{ size: "P", stock: 0 }, { size: "M", stock: 3 }] },
      {
        baseStock: 4,
        baseSizes: [{ size: "P", stock: 1 }, { size: "M", stock: 3 }],
        stock: 4,
        sizes: [{ size: "P", stock: 1 }, { size: "M", stock: 3 }],
      }
    );
    expect(result.sizes).toEqual([{ size: "P", stock: 0 }, { size: "M", stock: 3 }]);
    expect(result.changes).toEqual([]);
  });

  it("logs the pieces lost when the grid changes", () => {
    const result = applyStockEdit(
      { stock: 2, sizes: [{ size: "M", stock: 2 }] },
      { baseStock: 2, baseSizes: [{ size: "M", stock: 2 }], stock: 0, sizes: [{ size: "38", stock: 0 }] }
    );
    expect(result.stock).toBe(0);
    expect(result.changes).toEqual([{ size: "M", delta: -2, before: 2, after: 0 }]);
  });

  it("matches a stored \"PP\" (and repeated labels) to the form's \"TU\" instead of dropping it", () => {
    const result = applyStockEdit(
      { stock: 5, sizes: [{ size: "PP", stock: 3 }, { size: " TU ", stock: 1 }, { size: "M", stock: 1 }] },
      {
        baseStock: 5,
        baseSizes: [{ size: "TU", stock: 4 }, { size: "M", stock: 1 }],
        stock: 5,
        sizes: [{ size: "TU", stock: 4 }, { size: "M", stock: 1 }],
      }
    );
    expect(result.sizes).toEqual([{ size: "TU", stock: 4 }, { size: "M", stock: 1 }]);
    expect(result.stock).toBe(5);
    expect(result.changes).toEqual([]);
  });

  it("never goes below zero", () => {
    const result = applyStockEdit(
      { stock: 0, sizes: [{ size: "M", stock: 0 }] },
      { baseStock: 2, baseSizes: [{ size: "M", stock: 2 }], stock: 0, sizes: [{ size: "M", stock: 0 }] }
    );
    expect(result.sizes).toEqual([{ size: "M", stock: 0 }]);
  });

  it("edits a product without sizes by its total, leaving its sizes alone", () => {
    const result = applyStockEdit(
      { stock: 7, sizes: [] },
      { baseStock: 8, baseSizes: [{ size: "P", stock: 0 }], stock: 10, sizes: [{ size: "P", stock: 0 }] }
    );
    expect(result).toEqual({ stock: 9, sizes: null, changes: [{ size: "", delta: 2, before: 7, after: 9 }] });
  });
});

describe("parseStockEdit / requestedStockDelta", () => {
  it("is null for a request that did not send its starting stock", () => {
    expect(parseStockEdit({ stock: 3, sizes: [] })).toBeNull();
  });

  it("measures the requested change per grid or per total", () => {
    const sized = parseStockEdit({
      baseStock: 3,
      baseSizes: [{ size: "M", stock: 3 }],
      stock: 5,
      sizes: [{ size: "M", stock: 5 }],
    })!;
    expect(requestedStockDelta(sized)).toBe(2);

    const plain = parseStockEdit({ baseStock: 8, baseSizes: [], stock: 6, sizes: [] })!;
    expect(requestedStockDelta(plain)).toBe(-2);
  });
});
