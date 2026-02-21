import { NextRequest, NextResponse } from "next/server";
import { getOrders, getProducts } from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

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

function isBetween(date: Date, start: Date, end: Date): boolean {
  const time = date.getTime();
  return time >= start.getTime() && time <= end.getTime();
}

type BillDocLike = {
  id: string;
  amount?: number;
  status?: string;
  paidAt?: { toDate?: () => Date };
  dueDate?: { toDate?: () => Date };
};

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    // Only ADMIN can view reports
    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const { start, end } = getDateRange(startDate, endDate);
    const periodDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS) + 1);

    const prevEnd = new Date(start.getTime() - DAY_MS);
    const prevStart = new Date(prevEnd.getTime() - (periodDays - 1) * DAY_MS);

    const exchangesQuery = adminDb
      .collection("exchanges")
      .where("createdAt", ">=", Timestamp.fromDate(start))
      .where("createdAt", "<=", Timestamp.fromDate(end));

    const stockPurchasesQuery = adminDb
      .collection("stockPurchases")
      .where("createdAt", ">=", Timestamp.fromDate(start))
      .where("createdAt", "<=", Timestamp.fromDate(end));

    const [orders, previousOrders, products, billsSnapshot, exchangesSnapshot, stockPurchasesSnapshot] = await Promise.all([
      getOrders(start, end),
      getOrders(prevStart, prevEnd),
      getProducts(),
      adminDb.collection("bills").get(),
      exchangesQuery.get(),
      stockPurchasesQuery.get(),
    ]);

    const grossRevenue = orders.reduce((sum, o) => sum + (o.subtotal || 0), 0);
    const discounts = orders.reduce((sum, o) => sum + (o.discount || 0), 0);
    const revenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const items = orders.flatMap(o => o.items || []);
    const cost = items.reduce((sum, i) => sum + (i.totalCost || 0), 0);
    const profit = revenue - cost;
    const profitMargin = revenue > 0 ? profit / revenue : 0;
    const ordersCount = orders.length;
    const itemsSold = items.reduce((sum, i) => sum + (i.quantity || 0), 0);
    const averageTicket = ordersCount > 0 ? revenue / ordersCount : 0;

    const previousRevenue = previousOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const previousGross = previousOrders.reduce((sum, o) => sum + (o.subtotal || 0), 0);
    const previousDiscounts = previousOrders.reduce((sum, o) => sum + (o.discount || 0), 0);
    const previousItems = previousOrders.flatMap((o) => o.items || []);
    const previousCost = previousItems.reduce((sum, i) => sum + (i.totalCost || 0), 0);
    const previousProfit = previousRevenue - previousCost;
    const previousOrdersCount = previousOrders.length;
    const previousAverageTicket = previousOrdersCount > 0 ? previousRevenue / previousOrdersCount : 0;
    const previousProfitMargin = previousRevenue > 0 ? previousProfit / previousRevenue : 0;

    const payments = {
      cash: 0,
      debit: 0,
      credit: 0,
      pix: 0,
      payLater: 0,
      payLaterOutstanding: 0,
      payLaterReceived: 0,
      exchangeDifferenceIn: 0,
    };

    for (const exchangeDoc of exchangesSnapshot.docs) {
      const exchangeData = exchangeDoc.data() as {
        difference?: number;
        cashInAmount?: number;
      };

      const cashInAmount =
        typeof exchangeData.cashInAmount === "number"
          ? exchangeData.cashInAmount
          : Math.max(0, typeof exchangeData.difference === "number" ? exchangeData.difference : 0);

      payments.exchangeDifferenceIn += cashInAmount;
    }

    const stockPurchasesCost = stockPurchasesSnapshot.docs.reduce((sum, doc) => {
      const data = doc.data() as {
        totalCost?: number;
        quantity?: number;
        unitCost?: number;
      };

      if (typeof data.totalCost === "number") {
        return sum + data.totalCost;
      }

      const quantity = typeof data.quantity === "number" ? data.quantity : 0;
      const unitCost = typeof data.unitCost === "number" ? data.unitCost : 0;
      return sum + quantity * unitCost;
    }, 0);

    let nonFiadoReceived = 0;
    let ordersWithDiscount = 0;
    let discountedRevenue = 0;

    const salesByDay = new Map<string, { revenue: number; orders: number }>();

    const productPerf = new Map<
      string,
      { qty: number; revenue: number; cost: number; profit: number }
    >();

    for (const order of orders) {
      const orderDate = new Date(order.createdAt);
      const dayKey = `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, "0")}-${String(
        orderDate.getDate()
      ).padStart(2, "0")}`;
      const dayEntry = salesByDay.get(dayKey) || { revenue: 0, orders: 0 };
      dayEntry.revenue += order.totalAmount || 0;
      dayEntry.orders += 1;
      salesByDay.set(dayKey, dayEntry);

      if ((order.discount || 0) > 0) {
        ordersWithDiscount += 1;
        discountedRevenue += order.totalAmount || 0;
      }

      for (const item of order.items || []) {
        const id = item.productId || "unknown";
        const current = productPerf.get(id) || { qty: 0, revenue: 0, cost: 0, profit: 0 };
        current.qty += item.quantity || 0;
        current.revenue += item.totalRevenue || 0;
        current.cost += item.totalCost || 0;
        current.profit += (item.totalRevenue || 0) - (item.totalCost || 0);
        productPerf.set(id, current);
      }

      if (order.isPaidLater) {
        payments.payLater += order.totalAmount || 0;

        const remaining = typeof order.remainingAmount === "number"
          ? order.remainingAmount
          : (order.paidAt ? 0 : (order.totalAmount || 0));
        const received = typeof order.amountPaid === "number"
          ? order.amountPaid
          : (order.paidAt ? (order.totalAmount || 0) : 0);

        payments.payLaterOutstanding += remaining;
        payments.payLaterReceived += received;
        continue;
      }

      nonFiadoReceived += order.totalAmount || 0;

      for (const p of order.payments || []) {
        if (p.method === "DINHEIRO") payments.cash += p.amount || 0;
        if (p.method === "DEBITO") payments.debit += p.amount || 0;
        if (p.method === "CREDITO") payments.credit += p.amount || 0;
        if (p.method === "PIX") payments.pix += p.amount || 0;
      }
    }

    const totalStock = products.reduce((sum, p) => sum + (p.stock || 0), 0);
    const inventoryValue = products.reduce((sum, p) => sum + (p.stock || 0) * (p.costPrice || 0), 0);
    const inventorySaleValue = products.reduce((sum, p) => sum + (p.stock || 0) * (p.salePrice || 0), 0);

    const soldQtyByProduct = new Map<string, number>();
    for (const [productId, perf] of Array.from(productPerf.entries())) {
      soldQtyByProduct.set(productId, perf.qty);
    }

    const lowStockCount = products.filter((p) => (p.stock || 0) <= 2).length;
    const outOfStockCount = products.filter((p) => (p.stock || 0) <= 0).length;
    const deadStockCount = products.filter((p) => (p.stock || 0) > 0 && (soldQtyByProduct.get(p.id) || 0) === 0).length;
    const stockCoverageDays = cost > 0 ? inventoryValue / (cost / periodDays) : 0;
    const turnover = inventoryValue > 0 ? cost / inventoryValue : 0;

    const billDocs = billsSnapshot.docs.map(
      (doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }) as BillDocLike
    );

    let outflowsActual = 0;
    let pendingBillsNext30 = 0;

    const projStart = new Date(end.getTime() + DAY_MS);
    const projEnd = new Date(end.getTime() + 30 * DAY_MS);

    for (const bill of billDocs) {
      const amount = typeof bill.amount === "number" ? bill.amount : 0;
      const status = typeof bill.status === "string" ? bill.status.toUpperCase() : "";

      const paidAtValue = bill.paidAt as { toDate?: () => Date } | undefined;
      const dueDateValue = bill.dueDate as { toDate?: () => Date } | undefined;

      const paidAt = paidAtValue?.toDate ? paidAtValue.toDate() : null;
      const dueDate = dueDateValue?.toDate ? dueDateValue.toDate() : null;

      if (status === "PAID" && paidAt && isBetween(paidAt, start, end)) {
        outflowsActual += amount;
      }

      if (status === "PENDING" && dueDate && isBetween(dueDate, projStart, projEnd)) {
        pendingBillsNext30 += amount;
      }
    }

    const cashInActual = nonFiadoReceived + payments.payLaterReceived + payments.exchangeDifferenceIn;
    const netCashFlowActual = cashInActual - outflowsActual;
    const projectedInflowsNext30 = periodDays > 0 ? (cashInActual / periodDays) * 30 : 0;
    const projectedNetCashFlow30 = projectedInflowsNext30 - pendingBillsNext30;

    const operatingExpenses = outflowsActual;
    const netProfit = profit - operatingExpenses;
    const netMargin = revenue > 0 ? netProfit / revenue : 0;

    const productsById = new Map(products.map((p) => [p.id, p]));
    const profitabilityRows = Array.from(productPerf.entries())
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

    const topProfitProducts = profitabilityRows.slice(0, 10);
    const lowMarginProducts = profitabilityRows
      .filter((r) => r.margin < 0.15)
      .sort((a, b) => a.margin - b.margin)
      .slice(0, 10);

    const bestSalesDay = Array.from(salesByDay.entries())
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 1)
      .map(([day, data]) => ({ day, revenue: data.revenue, orders: data.orders }))[0] || null;

    const targetRevenue = previousRevenue > 0 ? previousRevenue * 1.1 : revenue;
    const targetAverageTicket = previousAverageTicket > 0 ? previousAverageTicket * 1.05 : averageTicket;
    const targetMargin = previousProfitMargin > 0 ? previousProfitMargin : 0.2;

    const achievementRevenue = targetRevenue > 0 ? revenue / targetRevenue : 0;
    const achievementTicket = targetAverageTicket > 0 ? averageTicket / targetAverageTicket : 0;
    const achievementMargin = targetMargin > 0 ? profitMargin / targetMargin : 0;

    const discountRate = grossRevenue > 0 ? discounts / grossRevenue : 0;
    const discountedOrdersRate = ordersCount > 0 ? ordersWithDiscount / ordersCount : 0;
    const avgDiscountPerDiscountedOrder = ordersWithDiscount > 0 ? discounts / ordersWithDiscount : 0;

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
    if (netMargin < 0.08) alerts.dre.push("Margem líquida abaixo de 8% considerando despesas pagas.");
    if (netCashFlowActual < 0) alerts.cashFlow.push("Fluxo de caixa real negativo no período.");
    if (projectedNetCashFlow30 < 0) alerts.cashFlow.push("Projeção dos próximos 30 dias indica déficit de caixa.");
    if (payments.payLaterOutstanding > revenue * 0.15) alerts.sales.push("Fiado em aberto acima de 15% da receita do período.");
    if (averageTicket < previousAverageTicket && previousAverageTicket > 0) alerts.sales.push("Ticket médio abaixo do período anterior.");
    if (deadStockCount > products.length * 0.2) alerts.inventory.push("Mais de 20% dos produtos estão sem giro no período.");
    if (outOfStockCount > 0) alerts.inventory.push("Existem produtos sem estoque (risco de ruptura).");
    if (lowMarginProducts.length > 0) alerts.profitability.push("Há produtos com margem abaixo de 15%.");
    if (achievementRevenue < 0.9) alerts.goals.push("Receita abaixo de 90% da meta.");
    if (discountRate > 0.12) alerts.promotions.push("Taxa de desconto acima de 12% da receita bruta.");

    const insights = {
      dre:
        netProfit >= 0
          ? "Operação com resultado positivo após despesas pagas no período."
          : "Operação fechou negativa após despesas pagas; revisar custos, despesas e política comercial.",
      cashFlow:
        projectedNetCashFlow30 >= 0
          ? "Projeção de caixa de 30 dias saudável com base no ritmo atual."
          : "Projeção de caixa de 30 dias pressionada; priorizar recebimento de fiado e renegociar vencimentos.",
      sales:
        bestSalesDay
          ? `Melhor dia de venda no período: ${bestSalesDay.day} (${bestSalesDay.orders} pedidos).`
          : "Sem dados suficientes de vendas para destacar melhor dia.",
      inventory:
        turnover > 0
          ? `Giro de estoque no período: ${turnover.toFixed(2)}x.`
          : "Sem giro de estoque no período analisado.",
      profitability:
        topProfitProducts.length > 0
          ? `Produto mais rentável: ${topProfitProducts[0].productName}.`
          : "Sem produtos vendidos para análise de rentabilidade.",
      goals:
        achievementRevenue >= 1
          ? "Meta de receita atingida no período."
          : "Meta de receita não atingida; revisar plano comercial semanal.",
      promotions:
        discounts > 0
          ? "Descontos estão ativos; acompanhar impacto na margem por campanha."
          : "Sem descontos relevantes no período.",
    };

    return NextResponse.json({
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
        days: periodDays,
      },
      grossRevenue,
      discounts,
      revenue,
      cost,
      profit,
      profitMargin,
      ordersCount,
      itemsSold,
      averageTicket,
      stockPurchasesCost,
      payments,
      totalStock,
      inventoryValue,
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
      cashFlow: {
        inflowsActual: cashInActual,
        outflowsActual,
        netCashFlowActual,
        projectedInflows30: projectedInflowsNext30,
        projectedOutflows30: pendingBillsNext30,
        projectedNetCashFlow30,
      },
      sales: {
        ordersCount,
        itemsSold,
        averageTicket,
        bestSalesDay,
        payLaterOutstanding: payments.payLaterOutstanding,
        payLaterReceived: payments.payLaterReceived,
      },
      inventory: {
        totalStock,
        inventoryValueCost: inventoryValue,
        inventoryValueSale: inventorySaleValue,
        stockCoverageDays,
        turnover,
        lowStockCount,
        outOfStockCount,
        deadStockCount,
      },
      profitability: {
        topProfitProducts,
        lowMarginProducts,
      },
      goals: {
        targetRevenue,
        targetAverageTicket,
        targetMargin,
        achievementRevenue,
        achievementAverageTicket: achievementTicket,
        achievementMargin,
        previousPeriod: {
          revenue: previousRevenue,
          grossRevenue: previousGross,
          discounts: previousDiscounts,
        },
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
      insights,
    });
  } catch (error) {
    console.error("Error generating report:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
