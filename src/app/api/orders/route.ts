import { NextRequest, NextResponse } from "next/server";
import { getOrders, getProduct } from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

function parseDateFilter(value: string | null, boundary: "start" | "end"): Date | undefined {
  if (!value) return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const isoValue = boundary === "start" ? `${value}T00:00:00.000` : `${value}T23:59:59.999`;
    const parsed = new Date(isoValue);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;

  if (boundary === "start") {
    parsed.setHours(0, 0, 0, 0);
  } else {
    parsed.setHours(23, 59, 59, 999);
  }

  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    const { searchParams } = new URL(request.url);
    const startDate = parseDateFilter(searchParams.get("startDate"), "start");
    const endDate = parseDateFilter(searchParams.get("endDate"), "end");

    const orders = await getOrders(startDate, endDate);

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
