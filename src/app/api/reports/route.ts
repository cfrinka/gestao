import { NextRequest, NextResponse } from "next/server";
import { getOrders, getProducts } from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

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

    const orders = await getOrders(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );

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

    const payments = {
      cash: 0,
      debit: 0,
      credit: 0,
      pix: 0,
      payLater: 0,
      payLaterOutstanding: 0,
      payLaterReceived: 0,
    };

    for (const order of orders) {
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

      for (const p of order.payments || []) {
        if (p.method === "DINHEIRO") payments.cash += p.amount || 0;
        if (p.method === "DEBITO") payments.debit += p.amount || 0;
        if (p.method === "CREDITO") payments.credit += p.amount || 0;
        if (p.method === "PIX") payments.pix += p.amount || 0;
      }
    }

    const products = await getProducts();
    const totalStock = products.reduce((sum, p) => sum + (p.stock || 0), 0);
    const inventoryValue = products.reduce((sum, p) => sum + (p.stock || 0) * (p.costPrice || 0), 0);

    return NextResponse.json({
      grossRevenue,
      discounts,
      revenue,
      cost,
      profit,
      profitMargin,
      ordersCount,
      itemsSold,
      averageTicket,
      payments,
      totalStock,
      inventoryValue,
    });
  } catch (error) {
    console.error("Error generating report:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
