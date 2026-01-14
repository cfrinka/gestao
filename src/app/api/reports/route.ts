import { NextRequest, NextResponse } from "next/server";
import { getOwners, getOwnerLedgers, getProducts } from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

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

    const owners = await getOwners();
    const reports = [];

    for (const owner of owners) {
      const ledgers = await getOwnerLedgers(
        owner.id,
        startDate ? new Date(startDate) : undefined,
        endDate ? new Date(endDate) : undefined
      );

      const revenue = ledgers.reduce((sum, l) => sum + l.revenue, 0);
      const cost = ledgers.reduce((sum, l) => sum + l.cost, 0);
      const profit = ledgers.reduce((sum, l) => sum + l.profit, 0);
      const profitMargin = revenue > 0 ? profit / revenue : 0;

      const products = await getProducts(owner.id);
      const totalStock = products.reduce((sum, p) => sum + p.stock, 0);
      const inventoryValue = products.reduce((sum, p) => sum + p.stock * p.costPrice, 0);

      reports.push({
        owner,
        revenue,
        cost,
        profit,
        profitMargin,
        totalStock,
        inventoryValue,
      });
    }

    return NextResponse.json(reports);
  } catch (error) {
    console.error("Error generating report:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
