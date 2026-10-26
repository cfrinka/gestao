import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { cached } from "@/lib/server-cache";
import { roundMoney } from "@/lib/money";
import { addDaysISO, endOfStoreDay, startOfStoreDay, todayISO } from "@/lib/dates";
import type { Client, Product } from "@/lib/db-types";
import { getProductsCached } from "@/domains/products/products-db";
import { getClients } from "@/domains/clients/clients-db";
import { daysSince, isOpenFiadoOrder, oldestOpenFiadoAt, toDate, type FiadoOrderLike } from "@/domains/clients/fiado-credit";
import { whatsappNumber } from "@/lib/phone";

/**
 * The store's day-to-day reports: what to reorder, what is not selling, and who owes. The
 * calculations are pure functions (tested on their own); the loaders below feed them from
 * Firestore and the server cache.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** At or below this many pieces a size is "acabando" — the same threshold the stock screens use. */
const LOW_STOCK = 2;
const NO_SIZE = "Único";

// Same order the product form prints its grids in (PP was renamed TU).
const SIZE_ORDER = ["TU", "PP", "P", "M", "G", "GG", "XG", "G1", "G2", "G3", "G4", "34", "36", "38", "40", "42", "44", "46", "48", "50", "52", "54"];

export function compareSizes(a: string, b: string): number {
  const ia = SIZE_ORDER.indexOf(a);
  const ib = SIZE_ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  return a.localeCompare(b, "pt-BR", { numeric: true });
}

function sizesOf(product: Product): Array<{ size: string; stock: number }> {
  return Array.isArray(product.sizes) && product.sizes.length > 0
    ? product.sizes.map((s) => ({ size: String(s.size || "").trim() || NO_SIZE, stock: Math.max(0, Number(s.stock || 0)) }))
    : [{ size: NO_SIZE, stock: Math.max(0, Number(product.stock || 0)) }];
}

// ───────────────────────────────── 1. Sizes and what to reorder ─────────────────────────────────

export interface SoldLine {
  productId: string;
  size: string;
  quantity: number;
  at: Date;
}

export interface SizeSummary {
  size: string;
  sold: number;
  stock: number;
  /** Share of the size's pieces that sold in the period: sold / (sold + stock). */
  sellThrough: number;
}

export interface RestockLine {
  productId: string;
  name: string;
  sku: string;
  image?: string;
  size: string;
  sold: number;
  stock: number;
  perWeek: number;
  /** Days the current stock lasts at the period's pace; null when nothing is left to last. */
  coverDays: number | null;
  /** Pieces to buy so the stock lasts `targetDays`. */
  suggested: number;
  urgency: "esgotado" | "acabando" | "atencao";
}

export function computeSizesAndRestock(
  lines: SoldLine[],
  products: Product[],
  periodDays: number,
  options: { targetDays?: number; warnCoverDays?: number } = {}
): { bySize: SizeSummary[]; restock: RestockLine[]; piecesSold: number } {
  const targetDays = options.targetDays ?? 30;
  const warnCoverDays = options.warnCoverDays ?? 21;
  const days = Math.max(1, periodDays);

  const soldByKey = new Map<string, number>();
  const soldBySize = new Map<string, number>();
  let piecesSold = 0;
  for (const line of lines) {
    const size = line.size.trim() || NO_SIZE;
    const quantity = Math.max(0, Number(line.quantity || 0));
    piecesSold += quantity;
    soldByKey.set(`${line.productId}::${size}`, (soldByKey.get(`${line.productId}::${size}`) || 0) + quantity);
    soldBySize.set(size, (soldBySize.get(size) || 0) + quantity);
  }

  const stockBySize = new Map<string, number>();
  const restock: RestockLine[] = [];
  const urgencyRank = { esgotado: 0, acabando: 1, atencao: 2 } as const;

  for (const product of products) {
    for (const { size, stock } of sizesOf(product)) {
      stockBySize.set(size, (stockBySize.get(size) || 0) + stock);

      const sold = soldByKey.get(`${product.id}::${size}`) || 0;
      if (sold <= 0) continue;

      const perDay = sold / days;
      const coverDays = stock > 0 ? Math.floor(stock / perDay) : null;
      const needsAttention = stock <= LOW_STOCK || (coverDays !== null && coverDays < warnCoverDays);
      if (!needsAttention) continue;

      restock.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        image: product.image,
        size,
        sold,
        stock,
        perWeek: Math.round(perDay * 7 * 10) / 10,
        coverDays,
        suggested: Math.max(1, Math.ceil(perDay * targetDays - stock)),
        urgency: stock === 0 ? "esgotado" : stock <= LOW_STOCK || (coverDays ?? 0) <= 7 ? "acabando" : "atencao",
      });
    }
  }

  restock.sort(
    (a, b) =>
      urgencyRank[a.urgency] - urgencyRank[b.urgency] ||
      (a.coverDays ?? -1) - (b.coverDays ?? -1) ||
      b.sold - a.sold
  );

  const sizes = new Set([...Array.from(soldBySize.keys()), ...Array.from(stockBySize.keys())]);
  const bySize = Array.from(sizes)
    .map((size) => {
      const sold = soldBySize.get(size) || 0;
      const stock = stockBySize.get(size) || 0;
      return { size, sold, stock, sellThrough: sold + stock > 0 ? sold / (sold + stock) : 0 };
    })
    .filter((row) => row.sold > 0 || row.stock > 0)
    .sort((a, b) => compareSizes(a.size, b.size));

  return { bySize, restock: restock.slice(0, 150), piecesSold };
}

// ───────────────────────────────────────── 2. Stagnant stock ─────────────────────────────────────

export interface StagnantLine {
  productId: string;
  name: string;
  sku: string;
  image?: string;
  stock: number;
  costValue: number;
  saleValue: number;
  /** Days without a sale (or, if it never sold in the window, since it was registered). */
  days: number;
  /** True when the window found no sale at all: `days` is then a lower bound. */
  noSaleInWindow: boolean;
  lastSaleAt: string | null;
  sizesInStock: Array<{ size: string; stock: number }>;
}

interface StagnantBucket {
  products: number;
  pieces: number;
  costValue: number;
}

export function computeStagnantStock(
  products: Product[],
  lastSaleByProduct: Map<string, Date>,
  now: Date,
  windowDays: number
): { lines: StagnantLine[]; buckets: { d30: StagnantBucket; d60: StagnantBucket; d90: StagnantBucket }; windowDays: number } {
  const buckets = {
    d30: { products: 0, pieces: 0, costValue: 0 },
    d60: { products: 0, pieces: 0, costValue: 0 },
    d90: { products: 0, pieces: 0, costValue: 0 },
  };
  const lines: StagnantLine[] = [];

  for (const product of products) {
    const stock = Math.max(0, Number(product.stock || 0));
    if (stock <= 0) continue;

    const lastSale = lastSaleByProduct.get(product.id) ?? null;
    const createdAt = toDate(product.createdAt);
    const windowStart = new Date(now.getTime() - windowDays * DAY_MS);
    // A product that arrived recently is not "stopped" just because it hasn't sold yet.
    const reference = lastSale ?? (createdAt && createdAt > windowStart ? createdAt : windowStart);
    const days = Math.max(0, Math.floor((now.getTime() - reference.getTime()) / DAY_MS));
    if (days < 30) continue;

    const costValue = roundMoney(stock * Number(product.costPrice || 0));
    const bucket = days >= 90 ? buckets.d90 : days >= 60 ? buckets.d60 : buckets.d30;
    bucket.products += 1;
    bucket.pieces += stock;
    bucket.costValue = roundMoney(bucket.costValue + costValue);

    lines.push({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      image: product.image,
      stock,
      costValue,
      saleValue: roundMoney(stock * Number(product.salePrice || 0)),
      days,
      noSaleInWindow: !lastSale && !(createdAt && createdAt > windowStart),
      lastSaleAt: lastSale ? lastSale.toISOString() : null,
      sizesInStock: sizesOf(product).filter((s) => s.stock > 0 && s.size !== NO_SIZE),
    });
  }

  lines.sort((a, b) => b.days - a.days || b.costValue - a.costValue);
  return { lines, buckets, windowDays };
}

// ─────────────────────────────────────── 3. Fiado collection ─────────────────────────────────────

export interface CollectionLine {
  clientId: string;
  name: string;
  phone: string | null;
  /** wa.me number (country code + area code + number), when the phone looks Brazilian. */
  whatsapp: string | null;
  owed: number;
  openPurchases: number;
  oldestOpenAt: string | null;
  daysOpen: number | null;
  lastPaymentAt: string | null;
}

export function computeFiadoCollection(
  clients: Client[],
  fiadoOrders: FiadoOrderLike[],
  now: Date
): {
  lines: CollectionLine[];
  totals: { owed: number; clients: number; over60: number; over90: number };
} {
  const ordersByClient = new Map<string, FiadoOrderLike[]>();
  for (const order of fiadoOrders) {
    if (!order.clientId) continue;
    const list = ordersByClient.get(order.clientId) ?? [];
    list.push(order);
    ordersByClient.set(order.clientId, list);
  }

  const lines: CollectionLine[] = [];
  const totals = { owed: 0, clients: 0, over60: 0, over90: 0 };

  for (const client of clients) {
    const owed = roundMoney(Number(client.balance || 0));
    if (owed < 0.01) continue;

    const orders = ordersByClient.get(client.id) ?? [];
    const open = orders.filter(isOpenFiadoOrder);
    const oldest = oldestOpenFiadoAt(open);
    const lastPayment = orders
      .flatMap((order) => (Array.isArray(order.paymentHistory) ? order.paymentHistory : []))
      .map((payment) => toDate(payment.createdAt))
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const daysOpen = oldest ? daysSince(oldest, now) : null;

    lines.push({
      clientId: client.id,
      name: client.name,
      phone: client.phone?.trim() || null,
      whatsapp: whatsappNumber(client.phone),
      owed,
      openPurchases: open.length,
      oldestOpenAt: oldest ? oldest.toISOString() : null,
      daysOpen,
      lastPaymentAt: lastPayment ? lastPayment.toISOString() : null,
    });

    totals.owed = roundMoney(totals.owed + owed);
    totals.clients += 1;
    if (daysOpen !== null && daysOpen > 60) totals.over60 = roundMoney(totals.over60 + owed);
    if (daysOpen !== null && daysOpen > 90) totals.over90 = roundMoney(totals.over90 + owed);
  }

  lines.sort((a, b) => (b.daysOpen ?? -1) - (a.daysOpen ?? -1) || b.owed - a.owed);
  return { lines, totals };
}

// ─────────────────────────────────────────── Loaders ─────────────────────────────────────────────

/** Pieces sold between two instants, leaving out cancelled sales. */
export async function loadSoldLines(start: Date, end: Date): Promise<SoldLine[]> {
  const [itemsSnapshot, ordersSnapshot] = await Promise.all([
    adminDb.collection("orderItems").where("createdAt", ">=", Timestamp.fromDate(start)).where("createdAt", "<=", Timestamp.fromDate(end)).get(),
    adminDb.collection("orders").where("createdAt", ">=", Timestamp.fromDate(start)).where("createdAt", "<=", Timestamp.fromDate(end)).get(),
  ]);
  const cancelled = new Set(ordersSnapshot.docs.filter((doc) => doc.data().isCancelled === true).map((doc) => doc.id));

  return itemsSnapshot.docs
    .map((doc) => doc.data() as { orderId?: string; productId?: string; size?: string; quantity?: number; createdAt?: unknown })
    .filter((item) => item.productId && !(item.orderId && cancelled.has(item.orderId)))
    .map((item) => ({
      productId: String(item.productId),
      size: String(item.size || ""),
      quantity: Number(item.quantity || 0),
      at: toDate(item.createdAt) ?? start,
    }));
}

export function getRestockReport(basisDays: number) {
  const days = [30, 60, 90].includes(basisDays) ? basisDays : 30;
  return cached(`report-restock:${days}`, async () => {
    const today = todayISO();
    const start = startOfStoreDay(addDaysISO(today, -(days - 1)))!;
    const end = endOfStoreDay(today)!;
    const [lines, products] = await Promise.all([loadSoldLines(start, end), getProductsCached()]);
    return { basisDays: days, ...computeSizesAndRestock(lines, products, days) };
  });
}

const STAGNANT_WINDOW_DAYS = 180;

export function getStagnantStockReport() {
  return cached("report-stagnant", async () => {
    const now = new Date();
    const start = startOfStoreDay(addDaysISO(todayISO(), -STAGNANT_WINDOW_DAYS))!;
    const [lines, products] = await Promise.all([loadSoldLines(start, now), getProductsCached()]);
    const lastSaleByProduct = new Map<string, Date>();
    for (const line of lines) {
      const previous = lastSaleByProduct.get(line.productId);
      if (!previous || line.at > previous) lastSaleByProduct.set(line.productId, line.at);
    }
    return computeStagnantStock(products, lastSaleByProduct, now, STAGNANT_WINDOW_DAYS);
  });
}

export function getFiadoCollectionReport() {
  return cached("report-fiado-collection", async () => {
    const [clients, fiadoSnapshot] = await Promise.all([
      getClients(),
      adminDb.collection("orders").where("isPaidLater", "==", true).get(),
    ]);
    const orders = fiadoSnapshot.docs.map((doc) => doc.data() as FiadoOrderLike);
    return computeFiadoCollection(clients, orders, new Date());
  });
}
