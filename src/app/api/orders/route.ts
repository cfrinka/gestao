import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { OrdersService } from "@/domains/orders/orders-service";
import { FirestoreOrdersRepository } from "@/domains/orders/firestore-orders-repository";
import { parseDateParam } from "@/lib/dates";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const { searchParams } = new URL(authorizedRequest.url);
      const startDate = parseDateParam(searchParams.get("startDate"), "start");
      const endDate = parseDateParam(searchParams.get("endDate"), "end");

      const service = new OrdersService(new FirestoreOrdersRepository());
      const orders = await service.list({ startDate, endDate });
      return NextResponse.json(orders);
    },
    { operationName: "Orders GET", cache: { scope: "shared" } }
  );
}

interface UpdateOrderBody {
  orderId?: string;
  discount?: number;
  payments?: Array<{ method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"; amount: number }>;
  customerPhone?: string;
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

      const service = new OrdersService(new FirestoreOrdersRepository());
      const cancelledOrder = await service.cancel({
        orderId: String(body.orderId || "").trim(),
        reason: body.reason,
        actorId: user.uid,
        actorRole: user.role,
        authTime: user.authTime,
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

      const service = new OrdersService(new FirestoreOrdersRepository());
      const updatedOrder = await service.update({
        orderId: String(body.orderId || "").trim(),
        discount: Number(body.discount || 0),
        payments: Array.isArray(body.payments) ? body.payments : [],
        customerPhone: body.customerPhone,
        actorId: user.uid,
        actorRole: user.role,
      });

      return NextResponse.json(updatedOrder);
    },
    { roles: ["ADMIN"], operationName: "Orders PATCH" }
  );
}
