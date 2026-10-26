export interface SizeStock {
  size: string;
  stock: number;
}

/**
 * What the product form changed: the stock it loaded (base) and the stock it is saving (desired).
 * The server applies the difference to the stock as it is now, so a sale made while the form was
 * open is not undone when the form is saved.
 */
export interface StockEdit {
  baseStock: number;
  baseSizes: SizeStock[];
  stock: number;
  sizes: SizeStock[];
}

export interface StockChange {
  size: string;
  delta: number;
  before: number;
  after: number;
}

function toCount(value: unknown): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Same label rule as the product form: trimmed, and the old "PP" is now "TU". */
function normalizeSizeLabel(value: unknown): string {
  const label = String(value || "").trim();
  return label.toUpperCase() === "PP" ? "TU" : label;
}

/**
 * Sizes keyed the way the form shows them (labels normalized, repeated labels merged), so a size
 * stored as "PP" is matched to the form's "TU" instead of looking like a size dropped from the grid.
 */
function toSizes(value: unknown): SizeStock[] {
  if (!Array.isArray(value)) return [];
  const bySize = new Map<string, number>();
  for (const entry of value) {
    const item = (entry || {}) as Record<string, unknown>;
    const size = normalizeSizeLabel(item.size);
    if (!size) continue;
    bySize.set(size, (bySize.get(size) || 0) + toCount(item.stock));
  }
  return Array.from(bySize.entries()).map(([size, stock]) => ({ size, stock }));
}

const total = (sizes: SizeStock[]) => sizes.reduce((sum, s) => sum + s.stock, 0);

/** Null when the request did not say what stock it started from (an older open tab). */
export function parseStockEdit(command: { baseStock?: unknown; baseSizes?: unknown; stock?: unknown; sizes?: unknown }): StockEdit | null {
  if (command.baseStock === undefined && command.baseSizes === undefined) return null;
  return {
    baseStock: toCount(command.baseStock),
    baseSizes: toSizes(command.baseSizes),
    stock: toCount(command.stock),
    sizes: toSizes(command.sizes),
  };
}

/** Pieces the form added (positive) or removed (negative) in total. */
export function requestedStockDelta(edit: StockEdit): number {
  if (edit.sizes.length > 0 && (total(edit.sizes) > 0 || total(edit.baseSizes) > 0)) {
    return total(edit.sizes) - total(edit.baseSizes);
  }
  return edit.stock - edit.baseStock;
}

/**
 * Applies the form's per-size difference to the current stock. Sizes dropped from the grid (a
 * letter ↔ numeric switch) lose their pieces, and that shows up as a change so it can be logged.
 */
export function applyStockEdit(
  current: { stock: number; sizes: SizeStock[] },
  edit: StockEdit
): { stock: number; sizes: SizeStock[] | null; changes: StockChange[] } {
  const currentSizes = toSizes(current.sizes);
  const usesSizes = currentSizes.length > 0 || total(edit.sizes) > 0 || total(edit.baseSizes) > 0;

  if (!usesSizes || edit.sizes.length === 0) {
    const before = toCount(current.stock);
    const after = Math.max(0, before + (edit.stock - edit.baseStock));
    return {
      stock: after,
      sizes: null, // leave the product's sizes as they are
      changes: after === before ? [] : [{ size: "", delta: after - before, before, after }],
    };
  }

  const baseBySize = new Map(edit.baseSizes.map((s) => [s.size, s.stock]));
  const currentBySize = new Map(currentSizes.map((s) => [s.size, s.stock]));
  const changes: StockChange[] = [];

  const sizes = edit.sizes.map(({ size, stock: desired }) => {
    const before = currentBySize.get(size) ?? 0;
    const after = Math.max(0, before + desired - (baseBySize.get(size) ?? 0));
    if (after !== before) changes.push({ size, delta: after - before, before, after });
    return { size, stock: after };
  });

  const kept = new Set(edit.sizes.map((s) => s.size));
  for (const { size, stock: before } of currentSizes) {
    if (!kept.has(size) && before > 0) {
      changes.push({ size, delta: -before, before, after: 0 });
    }
  }

  return { stock: total(sizes), sizes, changes };
}
