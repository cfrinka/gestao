import type { DemoDataset } from "@/lib/demo/demo-store";
import type { ReportsPayload, ReportsPaymentMix, ReportsFiadoAging, ReportsProductMarginRow } from "@/domains/reports/reports-service";

const DAY_MS = 24 * 60 * 60 * 1000;

type MonthAggregate = {
  month: string;
  source: "closure" | "live";
  grossRevenue: number;
  discounts: number;
  revenue: number;
  cogs: number;
  expenses: number;
  netResult: number;
  cashIn: number;
  cashOut: number;
  stockPurchasesCost: number;
  payLaterOutstandingSnapshot: number;
  ordersCount: number;
  payLaterSales: number;
  payLaterReceived: number;
  exchangeDifferenceIn: number;
  paymentMix: {
    cash: number;
    debit: number;
    credit: number;
    pix: number;
  };
};

/**
 * Demo-mode counterpart to reports-service.ts's `generateReports`. Reimplements exactly one of
 * the three code paths the real service can take — `legacy_collections` — because that's the
 * only one that applies here: the demo dataset has no `financialClosures` snapshots and no
 * `financialMovements` ledger, so every month is always computed straight from
 * orders/bills/stockPurchases/exchanges, the same way the real service falls back when a month
 * has no closure and no movements yet. Simplifications vs. the real legacy path:
 *  - No `financialClosures`/`financialMovements` lookups: `source` is always "live" and
 *    `snapshotUsed` is always false (there is never a closure to prefer over live data).
 *  - No `reportCache` (`reportCache` collection): every call recomputes; `cache` is a static
 *    `{ hit: false, ttlMs: 0 }` rather than a real cache decision.
 *  - Product margin ranking reads `order.items` (embedded on each Order in demoData, since the
 *    demo dataset has no separate `orderItems` collection) instead of querying `orderItems`.
 *  - Fiado aging is derived directly from `order.isPaidLater`/`order.remainingAmount`/
 *    `order.createdAt` (which the in-memory clients repository keeps up to date on every fiado
 *    payment) instead of replaying a `financialMovements` ledger — same aging math, different
 *    (equivalent, since the demo dataset doesn't model a ledger) source of truth.
 *  - Exchange cash-in uses `exchange.cashInAmount` + `exchange.paymentMethod` (the actual
 *    `ExchangeRecord` fields written by the exchanges repository) rather than the real legacy
 *    path's `totalDifference` field, which doesn't exist on `ExchangeRecord`/the exchanges
 *    Firestore doc — `cashInAmount` is `max(0, difference)`, i.e. exactly the positive
 *    difference the real aggregate is trying to capture.
 */

function toValidDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function getDateRange(startDateRaw: string | null, endDateRaw: string | null) {
  const now = new Date();
  const defaultEnd = new Date(now);
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 29);

  const start = toValidDate(startDateRaw) ?? defaultStart;
  const end = toValidDate(endDateRaw) ?? defaultEnd;
  return { start, end };
}

function toCompetencyMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function listMonthsBetween(start: Date, end: Date): string[] {
  const months: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cursor.getTime() <= last.getTime()) {
    months.push(toCompetencyMonth(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function getMonthDateRange(month: string): { start: Date; end: Date } {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  const start = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function getPaymentBucketMethod(method?: string): "cash" | "debit" | "credit" | "pix" | null {
  if (method === "cash" || method === "debit" || method === "credit" || method === "pix") return method;
  return null;
}

function mapLegacyOrderPaymentMethod(method?: string): "cash" | "debit" | "credit" | "pix" {
  if (method === "PIX") return "pix";
  if (method === "DEBITO") return "debit";
  if (method === "CREDITO") return "credit";
  return "cash";
}

function toDate(value: Date | string | undefined | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function emptyMonthAggregate(month: string): MonthAggregate {
  return {
    month,
    source: "live",
    grossRevenue: 0,
    discounts: 0,
    revenue: 0,
    cogs: 0,
    expenses: 0,
    netResult: 0,
    cashIn: 0,
    cashOut: 0,
    stockPurchasesCost: 0,
    payLaterOutstandingSnapshot: 0,
    ordersCount: 0,
    payLaterSales: 0,
    payLaterReceived: 0,
    exchangeDifferenceIn: 0,
    paymentMix: { cash: 0, debit: 0, credit: 0, pix: 0 },
  };
}

function buildAggregateFromLegacyCollections(month: string, dataset: DemoDataset): MonthAggregate {
  const aggregate = emptyMonthAggregate(month);
  const { start, end } = getMonthDateRange(month);
  const startMs = start.getTime();
  const endMs = end.getTime();

  for (const order of dataset.orders.values()) {
    if (order.isCancelled) continue;
    const createdAt = toDate(order.createdAt);
    if (!createdAt || createdAt.getTime() < startMs || createdAt.getTime() > endMs) continue;

    const subtotal = Number(order.subtotal || 0);
    const discount = Number(order.discount || 0);
    const totalAmount = Number(order.totalAmount || 0);
    const cogsTotal = Number(order.cogsTotal || 0);

    if (subtotal > 0) aggregate.grossRevenue += subtotal;
    if (discount > 0) aggregate.discounts += discount;
    if (totalAmount > 0) {
      aggregate.revenue += totalAmount;
      aggregate.cashIn += totalAmount;
      aggregate.ordersCount += 1;
    }
    if (cogsTotal > 0) {
      aggregate.cogs += cogsTotal;
      aggregate.cashOut += cogsTotal;
    }

    if (order.isPaidLater) {
      aggregate.payLaterSales += totalAmount;
    } else {
      const payments = Array.isArray(order.payments) ? order.payments : [];
      if (payments.length === 0 && totalAmount > 0) {
        aggregate.paymentMix.cash += totalAmount;
      }
      for (const payment of payments) {
        const amount = Number(payment.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const bucket = mapLegacyOrderPaymentMethod(payment.method);
        aggregate.paymentMix[bucket] += amount;
      }
    }
  }

  for (const bill of dataset.bills.values()) {
    if (bill.status !== "PAID") continue;
    const paidAt = toDate(bill.paidAt as Date | string | undefined | null);
    if (!paidAt || paidAt.getTime() < startMs || paidAt.getTime() > endMs) continue;

    const amount = Number(bill.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    aggregate.expenses += amount;
    aggregate.cashOut += amount;
  }

  for (const purchase of dataset.stockPurchases.values()) {
    const createdAt = toDate(purchase.createdAt);
    if (!createdAt || createdAt.getTime() < startMs || createdAt.getTime() > endMs) continue;

    const amount = Number(purchase.totalCost || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    aggregate.stockPurchasesCost += amount;
    aggregate.cashOut += amount;
  }

  for (const exchange of dataset.exchanges.values()) {
    const createdAt = toDate(exchange.createdAt);
    if (!createdAt || createdAt.getTime() < startMs || createdAt.getTime() > endMs) continue;

    // Real ExchangeRecord field for the positive cash-in from a swap difference is
    // `cashInAmount` (already clamped to max(0, difference)) plus `paymentMethod`, set only
    // when cashInAmount > 0 — see class-level comment for why this differs from the real
    // service's legacy-doc `totalDifference` field.
    const cashInAmount = Number(exchange.cashInAmount || 0);
    if (!Number.isFinite(cashInAmount) || cashInAmount <= 0) continue;
    aggregate.exchangeDifferenceIn += cashInAmount;
    aggregate.cashIn += cashInAmount;
    const bucket = getPaymentBucketMethod(exchange.paymentMethod);
    if (bucket) aggregate.paymentMix[bucket] += cashInAmount;
  }

  aggregate.netResult = aggregate.revenue - aggregate.cogs - aggregate.expenses;
  return aggregate;
}

function buildFiadoAging(endDate: Date, dataset: DemoDataset): ReportsFiadoAging {
  const buckets = { current30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
  const rows: Array<{ orderId: string; ageDays: number; outstanding: number }> = [];
  const endMs = endDate.getTime();

  for (const order of dataset.orders.values()) {
    if (!order.isPaidLater || order.isCancelled) continue;

    const createdAt = toDate(order.createdAt);
    if (!createdAt || createdAt.getTime() > endMs) continue;

    const totalAmount = Number(order.totalAmount || 0);
    const outstanding =
      typeof order.remainingAmount === "number" ? order.remainingAmount : Math.max(0, totalAmount - Number(order.amountPaid || 0));
    if (!Number.isFinite(outstanding) || outstanding <= 0) continue;

    const ageDays = Math.max(0, Math.floor((endMs - createdAt.getTime()) / DAY_MS));
    if (ageDays <= 30) buckets.current30 += outstanding;
    else if (ageDays <= 60) buckets.days31to60 += outstanding;
    else if (ageDays <= 90) buckets.days61to90 += outstanding;
    else buckets.days90plus += outstanding;

    rows.push({ orderId: order.id, ageDays, outstanding });
  }

  rows.sort((a, b) => b.outstanding - a.outstanding);

  return {
    asOf: endDate.toISOString(),
    totalOutstanding: sum([buckets.current30, buckets.days31to60, buckets.days61to90, buckets.days90plus]),
    buckets,
    topOpenOrders: rows.slice(0, 20),
  };
}

function buildProductMarginRanking(start: Date, end: Date, dataset: DemoDataset) {
  const startMs = start.getTime();
  const endMs = end.getTime();

  const productsById = dataset.products;
  const perfMap = new Map<string, { qty: number; revenue: number; cost: number; profit: number }>();

  for (const order of dataset.orders.values()) {
    if (order.isCancelled) continue;
    const createdAt = toDate(order.createdAt);
    if (!createdAt || createdAt.getTime() < startMs || createdAt.getTime() > endMs) continue;

    for (const item of order.items || []) {
      const productId = item.productId || "unknown";
      const qty = Number(item.quantity || 0);
      const revenue = Number(item.totalRevenue || 0);
      const cost = Number(item.totalCost || 0);
      const current = perfMap.get(productId) || { qty: 0, revenue: 0, cost: 0, profit: 0 };
      current.qty += qty;
      current.revenue += revenue;
      current.cost += cost;
      current.profit += revenue - cost;
      perfMap.set(productId, current);
    }
  }

  const ranking: ReportsProductMarginRow[] = Array.from(perfMap.entries())
    .map(([productId, perf]) => {
      const product = productsById.get(productId);
      const margin = perf.revenue > 0 ? perf.profit / perf.revenue : 0;
      return {
        productId,
        productName: product?.name || productId,
        sku: product?.sku || "-",
        qtySold: perf.qty,
        revenue: perf.revenue,
        cost: perf.cost,
        profit: perf.profit,
        margin,
      };
    })
    .sort((a, b) => b.profit - a.profit);

  const allProducts = Array.from(productsById.values());
  const totalStock = sum(allProducts.map((p) => Number(p.stock || 0)));
  const inventoryValue = sum(allProducts.map((p) => Number(p.stock || 0) * Number(p.costPrice || 0)));
  const inventorySaleValue = sum(allProducts.map((p) => Number(p.stock || 0) * Number(p.salePrice || 0)));

  const soldQtyByProduct = new Map<string, number>();
  for (const [productId, perf] of Array.from(perfMap.entries())) {
    soldQtyByProduct.set(productId, perf.qty);
  }

  const lowStockCount = allProducts.filter((p) => Number(p.stock || 0) <= 2).length;
  const outOfStockCount = allProducts.filter((p) => Number(p.stock || 0) <= 0).length;
  const deadStockCount = allProducts.filter((p) => Number(p.stock || 0) > 0 && (soldQtyByProduct.get(p.id) || 0) === 0).length;

  return {
    ranking,
    topProfitProducts: ranking.slice(0, 10),
    lowMarginProducts: ranking
      .filter((r) => r.margin < 0.15)
      .sort((a, b) => a.margin - b.margin)
      .slice(0, 10),
    totalStock,
    inventoryValue,
    inventorySaleValue,
    lowStockCount,
    outOfStockCount,
    deadStockCount,
  };
}

export async function generateDemoReports(input: {
  role: string;
  startDateRaw: string | null;
  endDateRaw: string | null;
  dataset: DemoDataset;
}): Promise<{ payload: ReportsPayload }> {
  const { dataset } = input;
  const { start, end } = getDateRange(input.startDateRaw, input.endDateRaw);
  const periodDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS) + 1);

  const prevEnd = new Date(start.getTime() - DAY_MS);
  const prevStart = new Date(prevEnd.getTime() - (periodDays - 1) * DAY_MS);

  const months = listMonthsBetween(start, end);
  const previousMonths = listMonthsBetween(prevStart, prevEnd);

  const monthAggregates = months.map((month) => buildAggregateFromLegacyCollections(month, dataset));
  const previousMonthAggregates = previousMonths.map((month) => buildAggregateFromLegacyCollections(month, dataset));
  const productData = buildProductMarginRanking(start, end, dataset);
  const fiadoAging = buildFiadoAging(end, dataset);

  const snapshotUsed = monthAggregates.some((m) => m.source === "closure");

  const grossRevenue = sum(monthAggregates.map((m) => m.grossRevenue));
  const discounts = sum(monthAggregates.map((m) => m.discounts));
  const revenue = sum(monthAggregates.map((m) => m.revenue));
  const cost = sum(monthAggregates.map((m) => m.cogs));
  const operatingExpenses = sum(monthAggregates.map((m) => m.expenses));
  const profit = revenue - cost;
  const netProfit = profit - operatingExpenses;
  const profitMargin = revenue > 0 ? profit / revenue : 0;
  const netMargin = revenue > 0 ? netProfit / revenue : 0;

  const ordersCount = sum(monthAggregates.map((m) => m.ordersCount));
  const itemsSold = sum(productData.ranking.map((r) => r.qtySold));
  const averageTicket = ordersCount > 0 ? revenue / ordersCount : 0;

  const paymentMix: ReportsPaymentMix = {
    cash: sum(monthAggregates.map((m) => m.paymentMix.cash)),
    debit: sum(monthAggregates.map((m) => m.paymentMix.debit)),
    credit: sum(monthAggregates.map((m) => m.paymentMix.credit)),
    pix: sum(monthAggregates.map((m) => m.paymentMix.pix)),
    payLater: sum(monthAggregates.map((m) => m.payLaterSales)),
    payLaterReceived: sum(monthAggregates.map((m) => m.payLaterReceived)),
    payLaterOutstanding:
      monthAggregates.length > 0 && monthAggregates[monthAggregates.length - 1].source === "closure"
        ? monthAggregates[monthAggregates.length - 1].payLaterOutstandingSnapshot
        : fiadoAging.totalOutstanding,
    exchangeDifferenceIn: sum(monthAggregates.map((m) => m.exchangeDifferenceIn)),
  };

  const cashFlow = {
    inflowsActual: sum(monthAggregates.map((m) => m.cashIn)),
    outflowsActual: sum(monthAggregates.map((m) => m.cashOut)),
  };
  const netCashFlowActual = cashFlow.inflowsActual - cashFlow.outflowsActual;
  const projectedInflows30 = periodDays > 0 ? (cashFlow.inflowsActual / periodDays) * 30 : 0;
  const projectedOutflows30 = periodDays > 0 ? (cashFlow.outflowsActual / periodDays) * 30 : 0;
  const projectedNetCashFlow30 = projectedInflows30 - projectedOutflows30;

  const previousRevenue = sum(previousMonthAggregates.map((m) => m.revenue));
  const previousCost = sum(previousMonthAggregates.map((m) => m.cogs));
  const previousProfit = previousRevenue - previousCost;
  const previousOrdersCount = sum(previousMonthAggregates.map((m) => m.ordersCount));
  const previousAverageTicket = previousOrdersCount > 0 ? previousRevenue / previousOrdersCount : 0;
  const previousProfitMargin = previousRevenue > 0 ? previousProfit / previousRevenue : 0;

  const targetRevenue = previousRevenue > 0 ? previousRevenue * 1.1 : revenue;
  const targetAverageTicket = previousAverageTicket > 0 ? previousAverageTicket * 1.05 : averageTicket;
  const targetMargin = previousProfitMargin > 0 ? previousProfitMargin : 0.2;
  const achievementRevenue = targetRevenue > 0 ? revenue / targetRevenue : 0;
  const achievementTicket = targetAverageTicket > 0 ? averageTicket / targetAverageTicket : 0;
  const achievementMargin = targetMargin > 0 ? profitMargin / targetMargin : 0;

  const ordersWithDiscount = monthAggregates.reduce((acc, month) => acc + (month.discounts > 0 ? month.ordersCount : 0), 0);
  const discountedRevenue = revenue;
  const discountRate = grossRevenue > 0 ? discounts / grossRevenue : 0;
  const discountedOrdersRate = ordersCount > 0 ? ordersWithDiscount / ordersCount : 0;
  const avgDiscountPerDiscountedOrder = ordersWithDiscount > 0 ? discounts / ordersWithDiscount : 0;

  const stockCoverageDays = cost > 0 ? productData.inventoryValue / (cost / periodDays) : 0;
  const turnover = productData.inventoryValue > 0 ? cost / productData.inventoryValue : 0;

  const monthlyDre = monthAggregates.map((month) => {
    const grossProfit = month.revenue - month.cogs;
    const netResult = grossProfit - month.expenses;
    return {
      month: month.month,
      source: month.source,
      revenue: month.revenue,
      cogs: month.cogs,
      grossProfit,
      expenses: month.expenses,
      netResult,
    };
  });

  const alerts = {
    dre: [] as string[],
    cashFlow: [] as string[],
    sales: [] as string[],
    inventory: [] as string[],
    profitability: [] as string[],
    goals: [] as string[],
    promotions: [] as string[],
  };

  if (profitMargin < 0.15) alerts.dre.push("Margem bruta abaixo de 15% no período.");
  if (netMargin < 0.08) alerts.dre.push("Margem líquida abaixo de 8% no período.");
  if (netCashFlowActual < 0) alerts.cashFlow.push("Fluxo de caixa real negativo no período.");
  if (projectedNetCashFlow30 < 0) alerts.cashFlow.push("Projeção de caixa dos próximos 30 dias está negativa.");
  if (paymentMix.payLaterOutstanding > revenue * 0.15) alerts.sales.push("Fiado em aberto acima de 15% da receita do período.");
  if (productData.deadStockCount > 0) alerts.inventory.push("Há produtos sem giro no período.");
  if (productData.outOfStockCount > 0) alerts.inventory.push("Há produtos sem estoque.");
  if (productData.lowMarginProducts.length > 0) alerts.profitability.push("Há produtos com margem abaixo de 15%.");
  if (achievementRevenue < 0.9) alerts.goals.push("Receita abaixo de 90% da meta.");
  if (discountRate > 0.12) alerts.promotions.push("Taxa de desconto acima de 12%.");

  const payload: ReportsPayload = {
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
      days: periodDays,
    },
    snapshotUsed,
    grossRevenue,
    discounts,
    revenue,
    cost,
    profit,
    profitMargin,
    ordersCount,
    itemsSold,
    averageTicket,
    stockPurchasesCost: sum(monthAggregates.map((m) => m.stockPurchasesCost)),
    payments: paymentMix,
    paymentMix,
    totalStock: productData.totalStock,
    inventoryValue: productData.inventoryValue,
    dre: {
      grossRevenue,
      discounts,
      netRevenue: revenue,
      cogs: cost,
      grossProfit: profit,
      grossMargin: profitMargin,
      operatingExpenses,
      netProfit,
      netMargin,
    },
    monthlyDre,
    cashFlow: {
      inflowsActual: cashFlow.inflowsActual,
      outflowsActual: cashFlow.outflowsActual,
      netCashFlowActual,
      projectedInflows30,
      projectedOutflows30,
      projectedNetCashFlow30,
    },
    sales: {
      ordersCount,
      itemsSold,
      averageTicket,
      bestSalesDay: null,
      payLaterOutstanding: paymentMix.payLaterOutstanding,
      payLaterReceived: paymentMix.payLaterReceived,
    },
    fiadoAging,
    inventory: {
      totalStock: productData.totalStock,
      inventoryValueCost: productData.inventoryValue,
      inventoryValueSale: productData.inventorySaleValue,
      stockCoverageDays,
      turnover,
      lowStockCount: productData.lowStockCount,
      outOfStockCount: productData.outOfStockCount,
      deadStockCount: productData.deadStockCount,
    },
    profitability: {
      topProfitProducts: productData.topProfitProducts,
      lowMarginProducts: productData.lowMarginProducts,
    },
    goals: {
      targetRevenue,
      targetAverageTicket,
      targetMargin,
      achievementRevenue,
      achievementAverageTicket: achievementTicket,
      achievementMargin,
    },
    promotions: {
      totalDiscounts: discounts,
      discountRate,
      ordersWithDiscount,
      discountedOrdersRate,
      avgDiscountPerDiscountedOrder,
      discountedRevenue,
    },
    alerts,
    insights: {
      dre: netProfit >= 0 ? "Resultado líquido positivo no período." : "Resultado líquido negativo no período.",
      cashFlow: projectedNetCashFlow30 >= 0 ? "Projeção de caixa saudável." : "Projeção de caixa pressionada.",
      sales: "Composição de pagamentos e fiado calculada a partir dos pedidos do período.",
      inventory: turnover > 0 ? `Giro de estoque: ${turnover.toFixed(2)}x.` : "Sem giro de estoque no período.",
      profitability:
        productData.topProfitProducts.length > 0
          ? `Produto mais rentável: ${productData.topProfitProducts[0].productName}.`
          : "Sem dados de rentabilidade por produto.",
      goals: achievementRevenue >= 1 ? "Meta de receita atingida." : "Meta de receita não atingida.",
      promotions: discounts > 0 ? "Descontos aplicados no período." : "Sem descontos no período.",
    },
    cache: { hit: false, ttlMs: 0 },
  };

  return { payload };
}
