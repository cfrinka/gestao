import { roundMoney } from "@/lib/money";
import type { DiscountSettings, Product, ProductDiscount } from "@/lib/db-types";
import { toDate } from "@/domains/clients/fiado-credit";
import { activeProductDiscount } from "@/domains/checkout/discount-calculator";

/**
 * Clearance: products with stock that did not sell in the chosen window, with a suggested
 * discounted price. The owner picks the products and sets the final price; the discount is then
 * a product discount the checkout already applies, with its own first and last day.
 * Pure rules here; the Firestore side is in clearance-db.ts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NO_SIZE = "Único";

/** The suggestion never goes below cost plus this margin: clearance frees cash, it doesn't lose it. */
export const MIN_MARKUP_OVER_COST = 1.2;

export interface ClearanceCandidate {
  productId: string;
  name: string;
  sku: string;
  image?: string;
  category?: string;
  stock: number;
  sizesInStock: Array<{ size: string; stock: number }>;
  costPrice: number;
  salePrice: number;
  /** Last sale found in the lookback, or null when there was none. */
  lastSaleAt: string | null;
  /** Days since the last sale, or since the product was registered if it never sold. */
  daysWithoutSale: number;
  /** No sale in the whole lookback: `daysWithoutSale` is at least the lookback. */
  noSaleInLookback: boolean;
  suggestedPrice: number | null;
  suggestedPercent: number | null;
  /** The product discount that counts today, if any. */
  current: { discountPercent: number; price: number; endsAt: string | null } | null;
}

/** Prices end in ,90: the largest such price at or below `value`. */
export function niceDown(value: number): number {
  const cents = Math.round(value * 100);
  return (Math.floor((cents + 10) / 100) * 100 - 10) / 100;
}

/** The smallest price ending in ,90 at or above `value`. */
export function niceUp(value: number): number {
  const cents = Math.round(value * 100);
  return (Math.ceil((cents + 10) / 100) * 100 - 10) / 100;
}

/** Percentage off the sale price that lands on `price`, kept precise enough to land on the cent. */
export function percentForPrice(salePrice: number, price: number): number {
  if (!(salePrice > 0)) return 0;
  return Math.round((1 - price / salePrice) * 100 * 10000) / 10000;
}

export function priceForPercent(salePrice: number, percent: number): number {
  return roundMoney(salePrice - roundMoney((salePrice * percent) / 100));
}

/** Longer without selling, deeper the cut. */
export function suggestedCut(daysWithoutSale: number): number {
  if (daysWithoutSale >= 180) return 0.5;
  if (daysWithoutSale >= 90) return 0.4;
  if (daysWithoutSale >= 60) return 0.3;
  return 0.2;
}

/**
 * The suggested clearance price: the cut for how long it has been stopped, ending in ,90, and
 * never below cost plus 20%. Null when the margin leaves no room for a discount.
 */
export function suggestClearancePrice(
  salePrice: number,
  costPrice: number,
  daysWithoutSale: number
): { price: number; percent: number } | null {
  if (!(salePrice > 0)) return null;
  const floor = Number(costPrice) > 0 ? niceUp(Number(costPrice) * MIN_MARKUP_OVER_COST) : 0;
  const price = Math.max(niceDown(salePrice * (1 - suggestedCut(daysWithoutSale))), floor);
  if (price <= 0 || price >= salePrice - 0.009) return null;
  return { price: roundMoney(price), percent: percentForPrice(salePrice, price) };
}

function sizesOf(product: Product): Array<{ size: string; stock: number }> {
  return Array.isArray(product.sizes) && product.sizes.length > 0
    ? product.sizes.map((s) => ({ size: String(s.size || "").trim() || NO_SIZE, stock: Math.max(0, Number(s.stock || 0)) }))
    : [{ size: NO_SIZE, stock: Math.max(0, Number(product.stock || 0)) }];
}

export function computeClearanceCandidates(
  products: Product[],
  lastSaleByProduct: Map<string, Date>,
  options: {
    now: Date;
    today: string;
    windowDays: number;
    lookbackDays: number;
    discounts: Pick<DiscountSettings, "productDiscountsEnabled" | "productDiscounts">;
  }
): {
  candidates: ClearanceCandidate[];
  /** In stock without a sale in the window, but registered inside it: too new to call stopped. */
  newArrivals: number;
  totals: { products: number; pieces: number; costValue: number; saleValue: number };
} {
  const { now, windowDays, lookbackDays } = options;
  const windowStart = now.getTime() - windowDays * DAY_MS;
  const candidates: ClearanceCandidate[] = [];
  const totals = { products: 0, pieces: 0, costValue: 0, saleValue: 0 };
  let newArrivals = 0;

  for (const product of products) {
    const stock = Math.max(0, Number(product.stock || 0));
    if (stock <= 0) continue;

    const lastSale = lastSaleByProduct.get(product.id) ?? null;
    if (lastSale && lastSale.getTime() >= windowStart) continue;

    const createdAt = toDate(product.createdAt);
    if (!lastSale && createdAt && createdAt.getTime() >= windowStart) {
      newArrivals += 1;
      continue;
    }

    const reference = lastSale ?? createdAt ?? new Date(now.getTime() - lookbackDays * DAY_MS);
    const daysWithoutSale = Math.max(windowDays, Math.floor((now.getTime() - reference.getTime()) / DAY_MS));
    const salePrice = roundMoney(Number(product.salePrice || 0));
    const costPrice = roundMoney(Number(product.costPrice || 0));
    const suggestion = suggestClearancePrice(salePrice, costPrice, daysWithoutSale);
    const active = activeProductDiscount(options.discounts, product.id, options.today);

    candidates.push({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      image: product.image,
      category: product.category,
      stock,
      sizesInStock: sizesOf(product).filter((s) => s.stock > 0 && s.size !== NO_SIZE),
      costPrice,
      salePrice,
      lastSaleAt: lastSale ? lastSale.toISOString() : null,
      daysWithoutSale,
      noSaleInLookback: !lastSale,
      suggestedPrice: suggestion?.price ?? null,
      suggestedPercent: suggestion?.percent ?? null,
      current: active
        ? { discountPercent: active.discountPercent, price: priceForPercent(salePrice, active.discountPercent), endsAt: active.endsAt ?? null }
        : null,
    });

    totals.products += 1;
    totals.pieces += stock;
    totals.costValue = roundMoney(totals.costValue + stock * costPrice);
    totals.saleValue = roundMoney(totals.saleValue + stock * salePrice);
  }

  candidates.sort((a, b) => b.daysWithoutSale - a.daysWithoutSale || b.stock * b.costPrice - a.stock * a.costPrice);
  return { candidates, newArrivals, totals };
}

export interface ClearanceInProgress {
  productId: string;
  name: string;
  sku: string;
  image?: string;
  salePrice: number;
  price: number;
  discountPercent: number;
  startsAt: string | null;
  endsAt: string | null;
  status: "ativa" | "agendada" | "encerrada";
  stock: number;
  /** Pieces sold since the discount started (or in the lookback, when it has no start date). */
  soldSinceStart: number;
}

/** Every product discount on file, with how it is doing. */
export function describeClearances(
  discounts: ProductDiscount[],
  products: Product[],
  soldLines: Array<{ productId: string; quantity: number; at: Date }>,
  today: string,
  startOfDay: (isoDate: string) => Date | null
): ClearanceInProgress[] {
  const productById = new Map(products.map((product) => [product.id, product]));
  return discounts
    .map((discount): ClearanceInProgress | null => {
      const product = productById.get(discount.productId);
      if (!product) return null;
      const salePrice = roundMoney(Number(product.salePrice || 0));
      const since = discount.startsAt ? startOfDay(discount.startsAt) : null;
      const soldSinceStart = soldLines
        .filter((line) => line.productId === discount.productId && (!since || line.at >= since))
        .reduce((sum, line) => sum + Math.max(0, Number(line.quantity || 0)), 0);
      const status: ClearanceInProgress["status"] =
        discount.endsAt && today > discount.endsAt ? "encerrada" : discount.startsAt && today < discount.startsAt ? "agendada" : "ativa";
      return {
        productId: discount.productId,
        name: product.name,
        sku: product.sku,
        image: product.image,
        salePrice,
        price: priceForPercent(salePrice, Number(discount.discountPercent || 0)),
        discountPercent: Number(discount.discountPercent || 0),
        startsAt: discount.startsAt ?? null,
        endsAt: discount.endsAt ?? null,
        status,
        stock: Math.max(0, Number(product.stock || 0)),
        soldSinceStart,
      };
    })
    .filter((line): line is ClearanceInProgress => line !== null)
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name, "pt-BR") : a.status === "ativa" ? -1 : b.status === "ativa" ? 1 : 0));
}
