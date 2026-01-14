import { NextRequest, NextResponse } from "next/server";
import { getOrders, getOwner, getProduct, getOwnerLedgers } from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const ownerId = searchParams.get("ownerId") || undefined;

    const orders = await getOrders(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      ownerId
    );

    const ordersWithDetails = await Promise.all(
      orders.map(async (order) => {
        const itemsWithDetails = await Promise.all(
          (order.items || []).map(async (item) => {
            const product = await getProduct(item.productId);
            const owner = await getOwner(item.ownerId);
            return { ...item, product, owner };
          })
        );

        const ledgers = await getOwnerLedgers(undefined, undefined, undefined);
        const orderLedgers = ledgers.filter((l) => l.orderId === order.id);
        const ledgersWithOwner = await Promise.all(
          orderLedgers.map(async (ledger) => {
            const owner = await getOwner(ledger.ownerId);
            return { ...ledger, owner };
          })
        );

        return { ...order, items: itemsWithDetails, ledgers: ledgersWithOwner };
      })
    );

    return NextResponse.json(ordersWithDetails);
  } catch (error) {
    console.error("Error fetching orders:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
