import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

interface OrderInfo {
  id: string;
  total: number;
  date: string;
  time: string;
  clientName: string;
  paymentMethod: string;
  isFiadoPayment?: boolean;
}

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

      // Default to current month if no dates provided
      const now = new Date();
      const defaultStart = startDate || new Date(now.getFullYear(), now.getMonth(), 1);
      const defaultEnd = endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      // Get all orders in the period
      const ordersSnapshot = await adminDb
        .collection("orders")
        .where("createdAt", ">=", Timestamp.fromDate(defaultStart))
        .where("createdAt", "<=", Timestamp.fromDate(defaultEnd))
        .where("isCancelled", "!=", true)
        .orderBy("createdAt", "asc")
        .get();

      // Get FIADO payments in the period
      const fiadoPaymentsSnapshot = await adminDb
        .collection("financialMovements")
        .where("type", "==", "FIADO_PAYMENT")
        .where("occurredAt", ">=", Timestamp.fromDate(defaultStart))
        .where("occurredAt", "<=", Timestamp.fromDate(defaultEnd))
        .orderBy("occurredAt", "asc")
        .get();

      // Process orders
      const ordersByDay = new Map<string, OrderInfo[]>();
      let monthTotal = 0;

      ordersSnapshot.docs.forEach((doc) => {
        const orderData = doc.data();
        const order = {
          id: doc.id,
          ...orderData,
          createdAt: orderData.createdAt?.toDate?.() || new Date(),
        };

        // Skip cancelled orders
        if (orderData.isCancelled) return;

        const date = order.createdAt.toLocaleDateString("pt-BR");
        const total = Number(orderData.totalAmount || 0);
        
        if (!ordersByDay.has(date)) {
          ordersByDay.set(date, []);
        }
        
        ordersByDay.get(date)!.push({
          id: order.id,
          total,
          date: order.createdAt.toLocaleDateString("pt-BR"),
          time: order.createdAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
          clientName: orderData.clientName || "Cliente",
          paymentMethod: orderData.payments?.[0]?.method || "N/A",
        });
        
        monthTotal += total;
      });

      // Process FIADO payments
      fiadoPaymentsSnapshot.docs.forEach((doc) => {
        const movementData = doc.data();
        const movement = {
          id: doc.id,
          ...movementData,
          occurredAt: movementData.occurredAt?.toDate?.() || new Date(),
        };

        const date = movement.occurredAt.toLocaleDateString("pt-BR");
        const amount = Number(movementData.amount || 0);
        const metadata = movementData.metadata as Record<string, unknown> || {};
        
        if (!ordersByDay.has(date)) {
          ordersByDay.set(date, []);
        }
        
        ordersByDay.get(date)!.push({
          id: `fiado-${movement.id}`,
          total: amount,
          date: movement.occurredAt.toLocaleDateString("pt-BR"),
          time: movement.occurredAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
          clientName: (metadata.description as string) || `Pagamento ${(metadata.clientName as string) || "Cliente"}`,
          paymentMethod: movementData.paymentMethod || "cash",
          isFiadoPayment: true,
        });
        
        monthTotal += amount;
      });

      // Sort days and orders within each day
      const sortedDays = Array.from(ordersByDay.entries())
        .sort(([a], [b]) => {
          const dateA = new Date(a.split('/').reverse().join('-'));
          const dateB = new Date(b.split('/').reverse().join('-'));
          return dateA.getTime() - dateB.getTime();
        })
        .map(([date, orders]) => ({
          date,
          orders: orders.sort((a, b) => a.time.localeCompare(b.time)),
          total: orders.reduce((sum, order) => sum + order.total, 0),
        }));

      return NextResponse.json({
        period: {
          start: defaultStart.toLocaleDateString("pt-BR"),
          end: defaultEnd.toLocaleDateString("pt-BR"),
        },
        monthTotal,
        days: sortedDays,
      });
    },
    { roles: ["ADMIN"], operationName: "Sales Month GET" }
  );
}
