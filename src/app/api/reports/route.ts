import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

type FinancialMovementDoc = {
  type?: string;
  direction?: "IN" | "OUT";
  amount?: number;
  paymentMethod?: "cash" | "debit" | "credit" | "pix";
  occurredAt?: Timestamp;
  competencyMonth?: string;
  relatedEntity?: { kind?: string; id?: string };
  metadata?: {
    subtotal?: number;
    discount?: number;
    isPaidLater?: boolean;
    payments?: Array<{ method?: "cash" | "debit" | "credit" | "pix"; amount?: number }>;
  };
};

type LegacyOrderDoc = {
  subtotal?: number;
  discount?: number;
  totalAmount?: number;
  cogsTotal?: number;
  isPaidLater?: boolean;
  payments?: Array<{ method?: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"; amount?: number }>;
};

type LegacyBillDoc = {
  amount?: number;
  status?: string;
};

type LegacyStockPurchaseDoc = {
  totalCost?: number;
};

type LegacyExchangeDoc = {
  totalDifference?: number;
  paymentMethod?: "cash" | "debit" | "credit" | "pix";
};

type ReportCacheDoc = {
  role?: string;
  startDate?: string;
  endDate?: string;
  generatedAt?: Timestamp;
  ttlMs?: number;
  payload?: Record<string, unknown>;
};

type LegacyDiagnostics = {
  ordersCount: number;
  paidBillsCount: number;
  stockPurchasesCount: number;
  exchangesCount: number;
};

type MonthDebugRow = {
  month: string;
  source: "closure" | "live_movements" | "legacy_collections";
  closureExists: boolean;
  movementCount: number;
  legacyDiagnostics: LegacyDiagnostics;
  totals: {
    revenue: number;
    cogs: number;
    expenses: number;
    netResult: number;
  };
};

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

function buildReportCacheKey(role: string, start: Date, end: Date, debugMode: boolean): string {
  const startKey = start.toISOString().slice(0, 10);
  const endKey = end.toISOString().slice(0, 10);
  return `${role}:${startKey}:${endKey}:${debugMode ? "debug" : "standard"}`;
}

function periodIncludesMonth(start: Date, end: Date, month: string): boolean {
  const monthStart = new Date(`${month}-01T00:00:00.000Z`);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999);
  return monthEnd.getTime() >= start.getTime() && monthStart.getTime() <= end.getTime();
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

function getMonthDateRange(month: string): { start: Date; end: Date } {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  const start = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

async function buildAggregateFromLegacyCollections(month: string): Promise<{
  aggregate: MonthAggregate;
  diagnostics: LegacyDiagnostics;
}> {
  const aggregate = emptyMonthAggregate(month);

  const { start, end } = getMonthDateRange(month);
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);

  const [ordersSnap, paidBillsSnap, stockPurchasesSnap, exchangesSnap] = await Promise.all([
    adminDb
      .collection("orders")
      .where("createdAt", ">=", startTs)
      .where("createdAt", "<=", endTs)
      .get(),
    adminDb
      .collection("bills")
      .where("status", "==", "PAID")
      .where("paidAt", ">=", startTs)
      .where("paidAt", "<=", endTs)
      .get(),
    adminDb
      .collection("stockPurchases")
      .where("createdAt", ">=", startTs)
      .where("createdAt", "<=", endTs)
      .get(),
    adminDb
      .collection("exchanges")
      .where("createdAt", ">=", startTs)
      .where("createdAt", "<=", endTs)
      .get(),
  ]);

  for (const doc of ordersSnap.docs) {
    const order = doc.data() as LegacyOrderDoc;
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

  for (const doc of paidBillsSnap.docs) {
    const bill = doc.data() as LegacyBillDoc;
    const amount = Number(bill.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    aggregate.expenses += amount;
    aggregate.cashOut += amount;
  }

  for (const doc of stockPurchasesSnap.docs) {
    const purchase = doc.data() as LegacyStockPurchaseDoc;
    const amount = Number(purchase.totalCost || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    aggregate.stockPurchasesCost += amount;
    aggregate.cashOut += amount;
  }

  for (const doc of exchangesSnap.docs) {
    const exchange = doc.data() as LegacyExchangeDoc;
    const totalDifference = Number(exchange.totalDifference || 0);
    if (!Number.isFinite(totalDifference) || totalDifference <= 0) continue;
    aggregate.exchangeDifferenceIn += totalDifference;
    aggregate.cashIn += totalDifference;
    const bucket = getPaymentBucketMethod(exchange.paymentMethod);
    if (bucket) aggregate.paymentMix[bucket] += totalDifference;
  }

  aggregate.netResult = aggregate.revenue - aggregate.cogs - aggregate.expenses;
  return {
    aggregate,
    diagnostics: {
      ordersCount: ordersSnap.size,
      paidBillsCount: paidBillsSnap.size,
      stockPurchasesCount: stockPurchasesSnap.size,
      exchangesCount: exchangesSnap.size,
    },
  };
}

function buildAggregateFromMovements(month: string, movements: FinancialMovementDoc[]): MonthAggregate {
  const aggregate = emptyMonthAggregate(month);

  for (const movement of movements) {
    const amount = Number(movement.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    if (movement.direction === "IN") aggregate.cashIn += amount;
    if (movement.direction === "OUT") aggregate.cashOut += amount;

    if (movement.type === "SALE_REVENUE") {
      aggregate.revenue += amount;
      aggregate.ordersCount += 1;

      const discount = Number(movement.metadata?.discount || 0);
      const subtotal = Number(movement.metadata?.subtotal || amount + discount);
      aggregate.discounts += discount;
      aggregate.grossRevenue += subtotal;

      if (movement.metadata?.isPaidLater) {
        aggregate.payLaterSales += amount;
      } else {
        const payments = Array.isArray(movement.metadata?.payments) ? movement.metadata?.payments : [];
        if (payments.length === 0) {
          aggregate.paymentMix.cash += amount;
        }

        for (const payment of payments) {
          const paymentAmount = Number(payment.amount || 0);
          const bucket = getPaymentBucketMethod(payment.method);
          if (!bucket || !Number.isFinite(paymentAmount) || paymentAmount <= 0) continue;
          aggregate.paymentMix[bucket] += paymentAmount;
        }
      }
    }

    if (movement.type === "COGS") {
      aggregate.cogs += amount;
    }

    if (movement.type === "OPERATING_EXPENSE") {
      aggregate.expenses += amount;
    }

    if (movement.type === "STOCK_PURCHASE") {
      aggregate.stockPurchasesCost += amount;
    }

    if (movement.type === "EXCHANGE_DIFFERENCE") {
      aggregate.exchangeDifferenceIn += amount;
      const bucket = getPaymentBucketMethod(movement.paymentMethod);
      if (bucket) aggregate.paymentMix[bucket] += amount;
    }

    if (movement.type === "FIADO_PAYMENT") {
      aggregate.payLaterReceived += amount;
      const bucket = getPaymentBucketMethod(movement.paymentMethod);
      if (bucket) aggregate.paymentMix[bucket] += amount;
    }
  }

  aggregate.netResult = aggregate.revenue - aggregate.cogs - aggregate.expenses;
  return aggregate;
}

async function buildMonthAggregateWithDebug(month: string): Promise<{ aggregate: MonthAggregate; debug: MonthDebugRow }> {
  const closureSnap = await adminDb.collection("financialClosures").doc(month).get();
  if (closureSnap.exists) {
    const closure = closureSnap.data() as {
      revenue?: number;
      cogs?: number;
      grossProfit?: number;
      expenses?: number;
      netResult?: number;
      cashIn?: number;
      cashOut?: number;
      fiadoOutstanding?: number;
    };

    const aggregate: MonthAggregate = {
      ...emptyMonthAggregate(month),
      source: "closure",
      revenue: Number(closure.revenue || 0),
      cogs: Number(closure.cogs || 0),
      expenses: Number(closure.expenses || 0),
      netResult: Number(closure.netResult || 0),
      cashIn: Number(closure.cashIn || 0),
      cashOut: Number(closure.cashOut || 0),
      payLaterOutstandingSnapshot: Number(closure.fiadoOutstanding || 0),
      grossRevenue: Number(closure.revenue || 0),
    };

    return {
      aggregate,
      debug: {
        month,
        source: "closure",
        closureExists: true,
        movementCount: 0,
        legacyDiagnostics: {
          ordersCount: 0,
          paidBillsCount: 0,
          stockPurchasesCount: 0,
          exchangesCount: 0,
        },
        totals: {
          revenue: aggregate.revenue,
          cogs: aggregate.cogs,
          expenses: aggregate.expenses,
          netResult: aggregate.netResult,
        },
      },
    };
  }

  const movementsSnapshot = await adminDb
    .collection("financialMovements")
    .where("competencyMonth", "==", month)
    .get();

  const movements = movementsSnapshot.docs.map((doc) => doc.data() as FinancialMovementDoc);
  if (movements.length === 0) {
    const legacy = await buildAggregateFromLegacyCollections(month);
    return {
      aggregate: legacy.aggregate,
      debug: {
        month,
        source: "legacy_collections",
        closureExists: false,
        movementCount: 0,
        legacyDiagnostics: legacy.diagnostics,
        totals: {
          revenue: legacy.aggregate.revenue,
          cogs: legacy.aggregate.cogs,
          expenses: legacy.aggregate.expenses,
          netResult: legacy.aggregate.netResult,
        },
      },
    };
  }

  const aggregate = buildAggregateFromMovements(month, movements);
  return {
    aggregate,
    debug: {
      month,
      source: "live_movements",
      closureExists: false,
      movementCount: movements.length,
      legacyDiagnostics: {
        ordersCount: 0,
        paidBillsCount: 0,
        stockPurchasesCount: 0,
        exchangesCount: 0,
      },
      totals: {
        revenue: aggregate.revenue,
        cogs: aggregate.cogs,
        expenses: aggregate.expenses,
        netResult: aggregate.netResult,
      },
    },
  };
}

async function buildMonthAggregate(month: string): Promise<MonthAggregate> {
  const result = await buildMonthAggregateWithDebug(month);
  return result.aggregate;
}

async function buildFiadoAging(endDate: Date) {
  const sales = new Map<string, { occurredAt: Date; amount: number }>();
  const payments = new Map<string, number>();

  const snapshot = await adminDb
    .collection("financialMovements")
    .where("occurredAt", "<=", Timestamp.fromDate(endDate))
    .get();

  for (const doc of snapshot.docs) {
    const movement = doc.data() as FinancialMovementDoc;
    const orderId = movement.relatedEntity?.kind === "order" ? movement.relatedEntity.id : null;
    if (!orderId) continue;

    const amount = Number(movement.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    if (movement.type === "SALE_REVENUE" && movement.metadata?.isPaidLater) {
      const occurredAt = movement.occurredAt?.toDate ? movement.occurredAt.toDate() : new Date();
      sales.set(orderId, { occurredAt, amount });
    }

    if (movement.type === "FIADO_PAYMENT") {
      payments.set(orderId, (payments.get(orderId) || 0) + amount);
    }
  }

  const buckets = { current30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
  const rows: Array<{ orderId: string; ageDays: number; outstanding: number }> = [];

  for (const [orderId, sale] of Array.from(sales.entries())) {
    const paid = payments.get(orderId) || 0;
    const outstanding = Math.max(0, sale.amount - paid);
    if (outstanding <= 0) continue;

    const ageDays = Math.max(0, Math.floor((endDate.getTime() - sale.occurredAt.getTime()) / DAY_MS));
    if (ageDays <= 30) buckets.current30 += outstanding;
    else if (ageDays <= 60) buckets.days31to60 += outstanding;
    else if (ageDays <= 90) buckets.days61to90 += outstanding;
    else buckets.days90plus += outstanding;

    rows.push({ orderId, ageDays, outstanding });
  }

  rows.sort((a, b) => b.outstanding - a.outstanding);

  return {
    asOf: endDate.toISOString(),
    totalOutstanding: sum([buckets.current30, buckets.days31to60, buckets.days61to90, buckets.days90plus]),
    buckets,
    topOpenOrders: rows.slice(0, 20),
  };
}

async function buildProductMarginRanking(start: Date, end: Date) {
  const [productsSnapshot, itemsSnapshot] = await Promise.all([
    adminDb.collection("products").get(),
    adminDb
      .collection("orderItems")
      .where("createdAt", ">=", Timestamp.fromDate(start))
      .where("createdAt", "<=", Timestamp.fromDate(end))
      .get(),
  ]);

  const productsById = new Map(
    productsSnapshot.docs.map((doc) => {
      const data = doc.data() as { name?: string; sku?: string; stock?: number; costPrice?: number; salePrice?: number };
      return [doc.id, { id: doc.id, ...data }];
    })
  );

  const perfMap = new Map<string, { qty: number; revenue: number; cost: number; profit: number }>();

  for (const itemDoc of itemsSnapshot.docs) {
    const item = itemDoc.data() as { productId?: string; quantity?: number; totalRevenue?: number; totalCost?: number };
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

  const ranking = Array.from(perfMap.entries())
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

  const totalStock = sum(
    Array.from(productsById.values()).map((p) => Number(p.stock || 0))
  );
  const inventoryValue = sum(
    Array.from(productsById.values()).map((p) => Number(p.stock || 0) * Number(p.costPrice || 0))
  );
  const inventorySaleValue = sum(
    Array.from(productsById.values()).map((p) => Number(p.stock || 0) * Number(p.salePrice || 0))
  );

  const soldQtyByProduct = new Map<string, number>();
  for (const [productId, perf] of Array.from(perfMap.entries())) {
    soldQtyByProduct.set(productId, perf.qty);
  }

  const lowStockCount = Array.from(productsById.values()).filter((p) => Number(p.stock || 0) <= 2).length;
  const outOfStockCount = Array.from(productsById.values()).filter((p) => Number(p.stock || 0) <= 0).length;
  const deadStockCount = Array.from(productsById.values()).filter((p) => Number(p.stock || 0) > 0 && (soldQtyByProduct.get(p.id) || 0) === 0).length;

  return {
    ranking,
    topProfitProducts: ranking.slice(0, 10),
    lowMarginProducts: ranking.filter((r) => r.margin < 0.15).sort((a, b) => a.margin - b.margin).slice(0, 10),
    totalStock,
    inventoryValue,
    inventorySaleValue,
    lowStockCount,
    outOfStockCount,
    deadStockCount,
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) return unauthorizedResponse();
    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const { start, end } = getDateRange(searchParams.get("startDate"), searchParams.get("endDate"));
    const forceRefreshParam = (searchParams.get("forceRefresh") || "").toLowerCase();
    const forceRefresh = forceRefreshParam === "1" || forceRefreshParam === "true";
    const debugParam = (searchParams.get("debug") || "").toLowerCase();
    const debugMode = debugParam === "1" || debugParam === "true";
    const periodDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS) + 1);
    const openMonth = toCompetencyMonth(new Date());
    const includesOpenMonth = periodIncludesMonth(start, end, openMonth);

    const cacheKey = buildReportCacheKey(user.role, start, end, debugMode);
    const cacheRef = adminDb.collection("reportCache").doc(cacheKey);
    const cacheSnapshot = await cacheRef.get();

    if (!forceRefresh && cacheSnapshot.exists) {
      const cacheData = cacheSnapshot.data() as ReportCacheDoc;
      const generatedAt = cacheData.generatedAt?.toDate ? cacheData.generatedAt.toDate() : null;
      const ttlMs = Number(cacheData.ttlMs || 0);
      const payload = cacheData.payload as Record<string, unknown> | undefined;

      if (generatedAt && ttlMs > 0 && payload) {
        const isFresh = Date.now() - generatedAt.getTime() <= ttlMs;
        if (isFresh) {
          return NextResponse.json({
            ...payload,
            cache: {
              hit: true,
              generatedAt: generatedAt.toISOString(),
              ttlMs,
            },
          });
        }
      }
    }

    const prevEnd = new Date(start.getTime() - DAY_MS);
    const prevStart = new Date(prevEnd.getTime() - (periodDays - 1) * DAY_MS);

    const months = listMonthsBetween(start, end);
    const previousMonths = listMonthsBetween(prevStart, prevEnd);

    const [monthResults, previousMonthResults, productData, fiadoAging] = await Promise.all([
      Promise.all(months.map((month) => buildMonthAggregateWithDebug(month))),
      Promise.all(previousMonths.map((month) => buildMonthAggregateWithDebug(month))),
      buildProductMarginRanking(start, end),
      buildFiadoAging(end),
    ]);

    const monthAggregates = monthResults.map((result) => result.aggregate);
    const previousMonthAggregates = previousMonthResults.map((result) => result.aggregate);

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

    const paymentMix = {
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

    const responsePayload = {
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
        sales: "Composição de pagamentos e fiado calculada a partir de movimentos financeiros.",
        inventory: turnover > 0 ? `Giro de estoque: ${turnover.toFixed(2)}x.` : "Sem giro de estoque no período.",
        profitability:
          productData.topProfitProducts.length > 0
            ? `Produto mais rentável: ${productData.topProfitProducts[0].productName}.`
            : "Sem dados de rentabilidade por produto.",
        goals: achievementRevenue >= 1 ? "Meta de receita atingida." : "Meta de receita não atingida.",
        promotions: discounts > 0 ? "Descontos aplicados no período." : "Sem descontos no período.",
      },
      ...(debugMode
        ? {
            debug: {
              monthlySources: monthResults.map((result) => result.debug),
              previousPeriodMonthlySources: previousMonthResults.map((result) => result.debug),
            },
          }
        : {}),
    };

    const ttlMs = includesOpenMonth ? 2 * 60 * 1000 : 30 * 60 * 1000;
    await cacheRef.set({
      role: user.role,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      generatedAt: Timestamp.now(),
      ttlMs,
      payload: responsePayload,
    });

    return NextResponse.json({
      ...responsePayload,
      cache: {
        hit: false,
        ttlMs,
      },
    });
  } catch (error) {
    console.error("Error generating report:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
