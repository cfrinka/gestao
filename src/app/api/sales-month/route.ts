import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { currentMonthISO, formatStoreDate, formatStoreTime, parseDateParam, storeMonthRange } from "@/lib/dates";

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

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const { searchParams } = new URL(authorizedRequest.url);
      const startDate = parseDateParam(searchParams.get("startDate"), "start");
      const endDate = parseDateParam(searchParams.get("endDate"), "end");

      // Default to current month if no dates provided
      const currentMonth = storeMonthRange(currentMonthISO())!;
      const defaultStart = startDate || currentMonth.start;
      const defaultEnd = endDate || currentMonth.end;

      // Get all orders in the period (isCancelled filtered in memory to avoid composite index)
      // A failed query used to fall back to an empty list, which the screen showed as a month
      // with R$ 0 in sales. Let it fail so the screen says so instead.
      const ordersSnapshot = await adminDb
        .collection("orders")
        .where("createdAt", ">=", Timestamp.fromDate(defaultStart))
        .where("createdAt", "<=", Timestamp.fromDate(defaultEnd))
        .get();
      const ordersDocs = ordersSnapshot.docs;

      // Get FIADO payments in the period. Avoid composite index by filtering type in memory.
      const fiadoPaymentsSnapshot = await adminDb
        .collection("financialMovements")
        .where("occurredAt", ">=", Timestamp.fromDate(defaultStart))
        .where("occurredAt", "<=", Timestamp.fromDate(defaultEnd))
        .get();
      const fiadoDocs = fiadoPaymentsSnapshot.docs.filter((d) => d.data()?.type === "FIADO_PAYMENT");

      // Process orders
      const ordersByDay = new Map<string, OrderInfo[]>();
      let monthTotal = 0;

      ordersDocs.forEach((doc) => {
        const orderData = doc.data();
        const order = {
          id: doc.id,
          ...orderData,
          createdAt: orderData.createdAt?.toDate?.() || new Date(),
        };

        // Skip cancelled orders
        if (orderData.isCancelled) return;

        const date = formatStoreDate(order.createdAt);
        const total = Number(orderData.totalAmount || 0);
        
        if (!ordersByDay.has(date)) {
          ordersByDay.set(date, []);
        }
        
        ordersByDay.get(date)!.push({
          id: order.id,
          total,
          date: formatStoreDate(order.createdAt),
          time: formatStoreTime(order.createdAt),
          clientName: orderData.clientName || "Cliente",
          paymentMethod: orderData.payments?.[0]?.method || "N/A",
        });
        
        monthTotal += total;
      });

      // Process FIADO payments
      fiadoDocs.forEach((doc) => {
        const movementData = doc.data();
        const movement = {
          id: doc.id,
          ...movementData,
          occurredAt: movementData.occurredAt?.toDate?.() || new Date(),
        };

        const date = formatStoreDate(movement.occurredAt);
        const amount = Number(movementData.amount || 0);
        const metadata = movementData.metadata as Record<string, unknown> || {};
        
        if (!ordersByDay.has(date)) {
          ordersByDay.set(date, []);
        }
        
        ordersByDay.get(date)!.push({
          id: `fiado-${movement.id}`,
          total: amount,
          date: formatStoreDate(movement.occurredAt),
          time: formatStoreTime(movement.occurredAt),
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
          start: formatStoreDate(defaultStart),
          end: formatStoreDate(defaultEnd),
        },
        monthTotal,
        days: sortedDays,
      });
    },
    { roles: ["ADMIN"], operationName: "Sales Month GET", cache: { scope: "shared" } }
  );
}
