import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { cached } from "@/lib/server-cache";
import { roundMoney } from "@/lib/money";
import { addDaysISO, startOfStoreDay, storeDateParts, todayISO } from "@/lib/dates";
import { nationalPhone } from "@/lib/phone";
import type { Client, Product } from "@/lib/db-types";
import { toDate } from "@/domains/clients/fiado-credit";
import { getProductsCached } from "@/domains/products/products-db";
import { getClients } from "@/domains/clients/clients-db";

/**
 * How the store sells: when, who sells, what discounts cost, which categories carry the margin,
 * who comes back, and what comes back as an exchange. Pure calculation first, loader at the end.
 */

export interface InsightOrder {
  id: string;
  subtotal?: number;
  discount?: number;
  totalAmount?: number;
  promoDiscount?: number;
  manualDiscount?: number;
  isCancelled?: boolean;
  createdAt?: unknown;
  createdById?: string;
  createdByName?: string;
  customerPhone?: string;
}

export interface InsightItem {
  orderId?: string;
  productId?: string;
  quantity?: number;
  totalRevenue?: number;
  totalCost?: number;
}

export interface InsightExchange {
  createdAt?: unknown;
  items?: Array<{ productId?: string; productName?: string; sku?: string; size?: string; quantity?: number; direction?: string }>;
}

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const NO_CATEGORY = "Sem categoria";

const DISCOUNT_BANDS: Array<{ label: string; upTo: number }> = [
  { label: "Sem desconto", upTo: 0.005 },
  { label: "Até 10%", upTo: 0.1 + 1e-9 },
  { label: "10% a 20%", upTo: 0.2 + 1e-9 },
  { label: "20% a 40%", upTo: 0.4 + 1e-9 },
  { label: "Acima de 40%", upTo: Infinity },
];

/** Monday-first weekday index (0 = Seg) and hour of a moment, on the store's clock. */
export function storeWeekdayHour(date: Date): { weekday: number; hour: number } {
  const parts = storeDateParts(date);
  const sundayFirst = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return { weekday: (sundayFirst + 6) % 7, hour: parts.hour };
}

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

export function computeSalesInsights(input: {
  orders: InsightOrder[];
  items: InsightItem[];
  products: Product[];
  clients: Client[];
}) {
  const orders = input.orders.filter((order) => order.isCancelled !== true);
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const items = input.items.filter((item) => item.orderId && orderById.has(item.orderId));
  const productById = new Map(input.products.map((product) => [product.id, product]));

  const piecesByOrder = new Map<string, number>();
  for (const item of items) {
    piecesByOrder.set(item.orderId!, (piecesByOrder.get(item.orderId!) || 0) + Math.max(0, Number(item.quantity || 0)));
  }

  // ── Totals ──
  const totals = { sales: orders.length, revenue: 0, pieces: 0, gross: 0, discount: 0, avgTicket: 0, piecesPerSale: 0 };
  for (const order of orders) {
    totals.revenue += Number(order.totalAmount || 0);
    totals.gross += Number(order.subtotal || 0);
    totals.discount += Number(order.discount || 0);
    totals.pieces += piecesByOrder.get(order.id) || 0;
  }
  totals.revenue = roundMoney(totals.revenue);
  totals.gross = roundMoney(totals.gross);
  totals.discount = roundMoney(totals.discount);
  totals.avgTicket = roundMoney(share(totals.revenue, totals.sales));
  totals.piecesPerSale = Math.round(share(totals.pieces, totals.sales) * 10) / 10;

  // ── When: weekday × hour ──
  const grid = WEEKDAYS.map(() => new Map<number, { sales: number; revenue: number }>());
  let minHour = 24;
  let maxHour = -1;
  for (const order of orders) {
    const at = toDate(order.createdAt);
    if (!at) continue;
    const { weekday, hour } = storeWeekdayHour(at);
    const cell = grid[weekday].get(hour) ?? { sales: 0, revenue: 0 };
    cell.sales += 1;
    cell.revenue = roundMoney(cell.revenue + Number(order.totalAmount || 0));
    grid[weekday].set(hour, cell);
    minHour = Math.min(minHour, hour);
    maxHour = Math.max(maxHour, hour);
  }
  const hours = maxHour >= 0 ? Array.from({ length: maxHour - minHour + 1 }, (_, i) => minHour + i) : [];
  const days = WEEKDAYS.map((label, weekday) => {
    const cells = hours.map((hour) => ({ hour, ...(grid[weekday].get(hour) ?? { sales: 0, revenue: 0 }) }));
    return {
      weekday,
      label,
      cells,
      sales: cells.reduce((sum, cell) => sum + cell.sales, 0),
      revenue: roundMoney(cells.reduce((sum, cell) => sum + cell.revenue, 0)),
    };
  });
  const byHour = hours.map((hour) => ({
    hour,
    sales: days.reduce((sum, day) => sum + (day.cells.find((cell) => cell.hour === hour)?.sales || 0), 0),
  }));
  const maxCellSales = Math.max(0, ...days.flatMap((day) => day.cells.map((cell) => cell.sales)));
  const busiestDay = days.reduce<(typeof days)[number] | null>((best, day) => (!best || day.revenue > best.revenue ? day : best), null);
  const busiestHour = byHour.reduce<(typeof byHour)[number] | null>((best, hour) => (!best || hour.sales > best.sales ? hour : best), null);

  // ── Who sells ──
  const sellerMap = new Map<string, { sellerId: string; name: string; sales: number; revenue: number; pieces: number; gross: number; discount: number }>();
  for (const order of orders) {
    const sellerId = order.createdById || order.createdByName || "?";
    const seller = sellerMap.get(sellerId) ?? {
      sellerId,
      name: order.createdByName?.trim() || "Sem nome",
      sales: 0,
      revenue: 0,
      pieces: 0,
      gross: 0,
      discount: 0,
    };
    seller.sales += 1;
    seller.revenue = roundMoney(seller.revenue + Number(order.totalAmount || 0));
    seller.pieces += piecesByOrder.get(order.id) || 0;
    seller.gross = roundMoney(seller.gross + Number(order.subtotal || 0));
    seller.discount = roundMoney(seller.discount + Number(order.discount || 0));
    sellerMap.set(sellerId, seller);
  }
  const sellers = Array.from(sellerMap.values())
    .map((seller) => ({
      ...seller,
      avgTicket: roundMoney(share(seller.revenue, seller.sales)),
      piecesPerSale: Math.round(share(seller.pieces, seller.sales) * 10) / 10,
      discountShare: share(seller.discount, seller.gross),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // ── What discounts cost ──
  const bands = DISCOUNT_BANDS.map((band) => ({ label: band.label, sales: 0, discount: 0 }));
  const split = { promo: 0, manual: 0, unsplit: 0 };
  let salesWithDiscount = 0;
  for (const order of orders) {
    const discount = Number(order.discount || 0);
    const rate = share(discount, Number(order.subtotal || 0));
    const band = bands[DISCOUNT_BANDS.findIndex((b) => rate < b.upTo)];
    band.sales += 1;
    band.discount = roundMoney(band.discount + discount);
    if (discount < 0.005) continue;
    salesWithDiscount += 1;
    // Sales from before the split was recorded only know the total.
    if (order.promoDiscount !== undefined || order.manualDiscount !== undefined) {
      split.promo = roundMoney(split.promo + Number(order.promoDiscount || 0));
      split.manual = roundMoney(split.manual + Number(order.manualDiscount || 0));
    } else {
      split.unsplit = roundMoney(split.unsplit + discount);
    }
  }
  const discounts = {
    gross: totals.gross,
    discount: totals.discount,
    share: share(totals.discount, totals.gross),
    salesWithDiscount,
    salesWithDiscountShare: share(salesWithDiscount, totals.sales),
    ...split,
    bands,
  };

  // ── Categories: each item's share of what its sale actually brought in ──
  const netShare = new Map(
    orders.map((order) => {
      const subtotal = Number(order.subtotal || 0);
      return [order.id, subtotal > 0 ? Math.min(1, Math.max(0, Number(order.totalAmount || 0) / subtotal)) : 1];
    })
  );
  const categoryMap = new Map<string, { category: string; pieces: number; revenue: number; cost: number }>();
  for (const item of items) {
    const category = productById.get(String(item.productId))?.category?.trim() || NO_CATEGORY;
    const line = categoryMap.get(category) ?? { category, pieces: 0, revenue: 0, cost: 0 };
    line.pieces += Math.max(0, Number(item.quantity || 0));
    line.revenue += Number(item.totalRevenue || 0) * (netShare.get(item.orderId!) ?? 1);
    line.cost += Number(item.totalCost || 0);
    categoryMap.set(category, line);
  }
  const categoryRevenue = Array.from(categoryMap.values()).reduce((sum, line) => sum + line.revenue, 0);
  const categories = Array.from(categoryMap.values())
    .map((line) => {
      const revenue = roundMoney(line.revenue);
      const cost = roundMoney(line.cost);
      return {
        category: line.category,
        pieces: line.pieces,
        revenue,
        cost,
        margin: roundMoney(revenue - cost),
        marginRate: share(revenue - cost, revenue),
        share: share(line.revenue, categoryRevenue),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // ── Who comes back (sales where the cashier took the customer's mobile) ──
  const clientByPhone = new Map<string, string>();
  for (const client of input.clients) {
    const digits = nationalPhone(client.phone);
    if (digits) clientByPhone.set(digits, client.name);
  }
  const customerMap = new Map<string, { phone: string; name: string | null; sales: number; revenue: number; lastAt: number }>();
  let salesWithPhone = 0;
  for (const order of orders) {
    const digits = nationalPhone(order.customerPhone);
    if (!digits) continue;
    salesWithPhone += 1;
    const at = toDate(order.createdAt)?.getTime() ?? 0;
    const customer = customerMap.get(digits) ?? { phone: order.customerPhone!, name: clientByPhone.get(digits) ?? null, sales: 0, revenue: 0, lastAt: 0 };
    customer.sales += 1;
    customer.revenue = roundMoney(customer.revenue + Number(order.totalAmount || 0));
    customer.lastAt = Math.max(customer.lastAt, at);
    customerMap.set(digits, customer);
  }
  const customerList = Array.from(customerMap.values());
  const customers = {
    salesWithPhone,
    salesWithPhoneShare: share(salesWithPhone, totals.sales),
    identified: customerList.length,
    returning: customerList.filter((customer) => customer.sales >= 2).length,
    top: customerList
      .sort((a, b) => b.sales - a.sales || b.revenue - a.revenue)
      .slice(0, 10)
      .map((customer) => ({ ...customer, lastAt: customer.lastAt ? new Date(customer.lastAt).toISOString() : null })),
  };

  return { totals, heatmap: { hours, days, byHour, maxCellSales, busiestDay, busiestHour }, sellers, discounts, categories, customers };
}

/** What came back on exchanges: per product, with the sizes returned and size-for-size swaps. */
export function computeExchangeInsights(exchanges: InsightExchange[], products: Product[]) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const byProduct = new Map<
    string,
    { productId: string; name: string; sku: string; image?: string; piecesIn: number; exchanges: number; sizesIn: Map<string, number>; sizeSwaps: number }
  >();
  const swaps = new Map<string, { from: string; to: string; count: number }>();
  let piecesIn = 0;
  let piecesOut = 0;

  for (const exchange of exchanges) {
    const lines = Array.isArray(exchange.items) ? exchange.items : [];
    const returned = lines.filter((line) => line.direction === "IN" && line.productId);
    const taken = lines.filter((line) => line.direction === "OUT" && line.productId);
    piecesIn += returned.reduce((sum, line) => sum + Math.max(0, Number(line.quantity || 0)), 0);
    piecesOut += taken.reduce((sum, line) => sum + Math.max(0, Number(line.quantity || 0)), 0);

    const seenInThisExchange = new Set<string>();
    for (const line of returned) {
      const productId = String(line.productId);
      const product = productById.get(productId);
      const entry = byProduct.get(productId) ?? {
        productId,
        name: product?.name || line.productName || "Produto",
        sku: product?.sku || line.sku || "",
        image: product?.image,
        piecesIn: 0,
        exchanges: 0,
        sizesIn: new Map<string, number>(),
        sizeSwaps: 0,
      };
      const quantity = Math.max(0, Number(line.quantity || 0));
      const size = String(line.size || "").trim();
      entry.piecesIn += quantity;
      if (size) entry.sizesIn.set(size, (entry.sizesIn.get(size) || 0) + quantity);
      if (!seenInThisExchange.has(productId)) {
        entry.exchanges += 1;
        seenInThisExchange.add(productId);
      }

      // The same product taken in another size: the size didn't fit.
      const swap = taken.find((out) => out.productId === productId && String(out.size || "").trim() && String(out.size || "").trim() !== size);
      if (swap && size) {
        entry.sizeSwaps += 1;
        const to = String(swap.size).trim();
        const key = `${size}→${to}`;
        const current = swaps.get(key) ?? { from: size, to, count: 0 };
        current.count += 1;
        swaps.set(key, current);
      }
      byProduct.set(productId, entry);
    }
  }

  return {
    count: exchanges.length,
    piecesIn,
    piecesOut,
    products: Array.from(byProduct.values())
      .map((entry) => ({
        ...entry,
        sizesIn: Array.from(entry.sizesIn.entries())
          .map(([size, pieces]) => ({ size, pieces }))
          .sort((a, b) => b.pieces - a.pieces),
      }))
      .sort((a, b) => b.piecesIn - a.piecesIn || b.exchanges - a.exchanges)
      .slice(0, 50),
    sizeSwaps: Array.from(swaps.values()).sort((a, b) => b.count - a.count),
  };
}

// ─────────────────────────────────────────── Loaders ─────────────────────────────────────────────

function periodStart(days: number): Date {
  return startOfStoreDay(addDaysISO(todayISO(), -(days - 1)))!;
}

export function getSalesInsights(periodDays: number) {
  const days = [30, 90, 180].includes(periodDays) ? periodDays : 30;
  return cached(`report-sales-insights:${days}`, async () => {
    const start = Timestamp.fromDate(periodStart(days));
    const [ordersSnap, itemsSnap, products, clients] = await Promise.all([
      adminDb.collection("orders").where("createdAt", ">=", start).get(),
      adminDb.collection("orderItems").where("createdAt", ">=", start).get(),
      getProductsCached(),
      cached("clients:list", getClients),
    ]);
    return {
      periodDays: days,
      ...computeSalesInsights({
        orders: ordersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as InsightOrder),
        items: itemsSnap.docs.map((doc) => doc.data() as InsightItem),
        products,
        clients,
      }),
    };
  });
}

export function getExchangeInsights(periodDays: number) {
  const days = [30, 90, 180].includes(periodDays) ? periodDays : 90;
  return cached(`report-exchange-insights:${days}`, async () => {
    const [snapshot, products] = await Promise.all([
      adminDb.collection("exchanges").where("createdAt", ">=", Timestamp.fromDate(periodStart(days))).get(),
      getProductsCached(),
    ]);
    return { periodDays: days, ...computeExchangeInsights(snapshot.docs.map((doc) => doc.data() as InsightExchange), products) };
  });
}
