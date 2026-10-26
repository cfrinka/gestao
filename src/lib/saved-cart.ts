/**
 * The sale in progress at the POS, kept in this browser so leaving the PDV screen (or reloading
 * it) doesn't empty the cart. One cart per user; it lasts 12 hours, so yesterday's forgotten sale
 * doesn't come back. Only ids, sizes and quantities are kept: prices and stock always come from
 * the catalogue when the cart is restored.
 */

export interface SavedCartLine {
  productId: string;
  size: string;
  quantity: number;
}

interface StockedProduct {
  id: string;
  stock: number;
  sizes?: Array<{ size: string; stock: number }>;
}

const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const keyFor = (userId: string) => `pos-cart:${userId}`;

export function readSavedCart(userId: string, now = Date.now()): SavedCartLine[] {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const saved = JSON.parse(raw) as { savedAt?: number; lines?: SavedCartLine[] };
    if (!saved.savedAt || now - saved.savedAt > MAX_AGE_MS || !Array.isArray(saved.lines)) {
      localStorage.removeItem(keyFor(userId));
      return [];
    }
    return saved.lines.filter(
      (line) => line && typeof line.productId === "string" && typeof line.size === "string" && Number(line.quantity) > 0
    );
  } catch {
    return [];
  }
}

export function writeSavedCart(userId: string, lines: SavedCartLine[], now = Date.now()): void {
  try {
    if (lines.length === 0) localStorage.removeItem(keyFor(userId));
    else localStorage.setItem(keyFor(userId), JSON.stringify({ savedAt: now, lines }));
  } catch {
    // Storage blocked or full: the cart still works, it just won't survive leaving the screen.
  }
}

/**
 * Rebuilds the cart from the current catalogue: products that no longer exist are dropped and
 * quantities are trimmed to the stock there is now (a size that sold out meanwhile drops out).
 */
export function restoreCartLines<P extends StockedProduct>(
  lines: SavedCartLine[],
  products: P[]
): { cart: Array<{ product: P; size: string; quantity: number }>; dropped: number } {
  const byId = new Map(products.map((product) => [product.id, product]));
  const cart: Array<{ product: P; size: string; quantity: number }> = [];
  let dropped = 0;

  for (const line of lines) {
    const product = byId.get(line.productId);
    const stock = !product
      ? 0
      : product.sizes && product.sizes.length > 0
        ? product.sizes.find((s) => s.size === line.size)?.stock ?? 0
        : product.stock;
    const quantity = Math.min(Math.floor(Number(line.quantity)), Math.max(0, Number(stock) || 0));
    if (!product || quantity < 1) {
      dropped += 1;
      continue;
    }
    if (quantity < line.quantity) dropped += 1;
    cart.push({ product, size: line.size, quantity });
  }

  return { cart, dropped };
}
