import { NextRequest, NextResponse } from "next/server";
import { cancelOrder, getOrders, getProduct, updateOrder } from "@/lib/db";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";

const RECENT_AUTH_WINDOW_SECONDS = 5 * 60;

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
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const { searchParams } = new URL(authorizedRequest.url);
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
    },
    { operationName: "Orders GET" }
  );
}

interface UpdateOrderBody {
  orderId?: string;
  discount?: number;
  payments?: Array<{ method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"; amount: number }>;
}

interface CancelOrderBody {
  orderId?: string;
  reason?: string;
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = (await authorizedRequest.json()) as CancelOrderBody;
      const orderId = String(body.orderId || "").trim();
      if (!orderId) {
        return NextResponse.json({ error: "orderId is required" }, { status: 400 });
      }

      const authTime = Number(user.authTime || 0);
      const nowInSeconds = Math.floor(Date.now() / 1000);
      const isRecentAuth = authTime > 0 && nowInSeconds - authTime <= RECENT_AUTH_WINDOW_SECONDS;
      if (!isRecentAuth) {
        return NextResponse.json(
          { error: "Confirmação de senha expirada. Informe a senha novamente para cancelar a venda." },
          { status: 401 }
        );
      }

      const cancelledOrder = await cancelOrder({
        orderId,
        reason: String(body.reason || "").trim(),
        actorId: user.uid,
        actorRole: user.role,
      });

      return NextResponse.json(cancelledOrder);
    },
    { roles: ["ADMIN"], operationName: "Orders POST Cancel" }
  );
}

export async function PATCH(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = (await authorizedRequest.json()) as UpdateOrderBody;
      const orderId = String(body.orderId || "").trim();
      if (!orderId) {
        return NextResponse.json({ error: "orderId is required" }, { status: 400 });
      }

      const discount = Number(body.discount || 0);
      const payments = Array.isArray(body.payments) ? body.payments : [];

      const updatedOrder = await updateOrder({
        orderId,
        discount,
        payments,
        actorId: user.uid,
        actorRole: user.role,
      });

      return NextResponse.json(updatedOrder);
    },
    { roles: ["ADMIN"], operationName: "Orders PATCH" }
  );
}
