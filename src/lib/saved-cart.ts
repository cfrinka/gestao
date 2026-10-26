/**
 * The sales in progress at the POS, kept in this browser so leaving the PDV screen (or reloading
 * it) doesn't empty them. Each user has their own; they last 12 hours, so yesterday's forgotten
 * sale doesn't come back. Only ids, sizes and quantities are kept: prices and stock always come
 * from the catalogue when a cart is restored.
 */

export interface SavedCartLine {
  productId: string;
  size: string;
  quantity: number;
}

export interface SavedCart {
  id: string;
  /** Position it was opened in, for the default label "Carrinho 2". */
  number: number;
  /** Who the cart is for, when the cashier wrote it. */
  name: string;
  lines: SavedCartLine[];
}

interface StockedProduct {
  id: string;
  stock: number;
  sizes?: Array<{ size: string; stock: number }>;
}

const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const keyFor = (userId: string) => `pos-cart:${userId}`;

function validLines(lines: unknown): SavedCartLine[] {
  if (!Array.isArray(lines)) return [];
  return lines.filter(
    (line): line is SavedCartLine =>
      Boolean(line) && typeof line.productId === "string" && typeof line.size === "string" && Number(line.quantity) > 0
  );
}

export function readSavedCarts(userId: string, now = Date.now()): { carts: SavedCart[]; activeId: string | null } {
  const none = { carts: [], activeId: null };
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return none;
    const saved = JSON.parse(raw) as { savedAt?: number; lines?: unknown; carts?: unknown; activeId?: unknown };
    if (!saved.savedAt || now - saved.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(keyFor(userId));
      return none;
    }
    // A single cart saved before there could be several.
    if (!Array.isArray(saved.carts)) {
      const lines = validLines(saved.lines);
      return lines.length > 0 ? { carts: [{ id: "cart-1", number: 1, name: "", lines }], activeId: "cart-1" } : none;
    }
    const carts = saved.carts
      .filter((cart): cart is SavedCart => Boolean(cart) && typeof (cart as SavedCart).id === "string")
      .map((cart, index) => ({
        id: cart.id,
        number: Number(cart.number) > 0 ? Number(cart.number) : index + 1,
        name: typeof cart.name === "string" ? cart.name : "",
        lines: validLines(cart.lines),
      }));
    return { carts, activeId: typeof saved.activeId === "string" ? saved.activeId : null };
  } catch {
    return none;
  }
}

/** Saves the open carts; when none has anything in it, nothing is kept. */
export function writeSavedCarts(userId: string, carts: SavedCart[], activeId: string, now = Date.now()): void {
  try {
    const worthKeeping = carts.filter((cart) => cart.lines.length > 0 || cart.name.trim());
    if (!carts.some((cart) => cart.lines.length > 0)) localStorage.removeItem(keyFor(userId));
    else localStorage.setItem(keyFor(userId), JSON.stringify({ savedAt: now, activeId, carts: worthKeeping }));
  } catch {
    // Storage blocked or full: the carts still work, they just won't survive leaving the screen.
  }
}

/**
 * Rebuilds a cart from the current catalogue: products that no longer exist are dropped and
 * quantities are trimmed to the stock there is now (a size that sold out meanwhile drops out).
 * `held` carries what carts restored before this one already took, so two carts never hold the
 * same last piece; it is updated with this cart's pieces.
 */
export function restoreCartLines<P extends StockedProduct>(
  lines: SavedCartLine[],
  products: P[],
  held: Map<string, number> = new Map()
): { cart: Array<{ product: P; size: string; quantity: number }>; dropped: number } {
  const byId = new Map(products.map((product) => [product.id, product]));
  const cart: Array<{ product: P; size: string; quantity: number }> = [];
  let dropped = 0;

  for (const line of lines) {
    const product = byId.get(line.productId);
    const key = `${line.productId}::${line.size}`;
    const stock = !product
      ? 0
      : product.sizes && product.sizes.length > 0
        ? product.sizes.find((s) => s.size === line.size)?.stock ?? 0
        : product.stock;
    const free = Math.max(0, (Number(stock) || 0) - (held.get(key) || 0));
    const quantity = Math.min(Math.floor(Number(line.quantity)), free);
    if (!product || quantity < 1) {
      dropped += 1;
      continue;
    }
    if (quantity < line.quantity) dropped += 1;
    held.set(key, (held.get(key) || 0) + quantity);
    cart.push({ product, size: line.size, quantity });
  }

  return { cart, dropped };
}
