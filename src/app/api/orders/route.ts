import { NextRequest, NextResponse } from "next/server";
import { getOrders, getProduct } from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const orders = await getOrders(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );

    const ordersWithDetails = await Promise.all(
      orders.map(async (order) => {
        const itemsWithDetails = await Promise.all(
          (order.items || []).map(async (item) => {
            const product = await getProduct(item.productId);
            return { ...item, product };
          })
        );

        const paymentHistory = Array.isArray((order as unknown as { paymentHistory?: unknown }).paymentHistory)
          ? (order as unknown as { paymentHistory: Array<{ createdAt?: unknown }> }).paymentHistory.map((p) => ({
              ...p,
              createdAt:
                p.createdAt && typeof p.createdAt === "object" && "toDate" in (p.createdAt as object)
                  ? (p.createdAt as { toDate: () => Date }).toDate()
                  : p.createdAt,
            }))
          : undefined;

        return { ...order, items: itemsWithDetails, ...(paymentHistory ? { paymentHistory } : {}) };
      })
    );

    return NextResponse.json(ordersWithDetails);
  } catch (error) {
    console.error("Error fetching orders:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
