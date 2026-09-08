import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { ClientsService } from "@/domains/clients/clients-service";
import { getClientsRepository } from "@/domains/clients/clients-repository-factory";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  return withAuthorizedRoute(
    request,
    async () => {
      const service = new ClientsService(getClientsRepository());
      const client = await service.get(id);
      return NextResponse.json(client);
    },
    { roles: ["ADMIN"], operationName: "Client GET" }
  );
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const body = await authorizedRequest.json();
      const service = new ClientsService(getClientsRepository());
      const updatedClient = await service.update({
        clientId: id,
        name: body.name,
        phone: body.phone,
        email: body.email,
        notes: body.notes,
      });
      return NextResponse.json(updatedClient);
    },
    { roles: ["ADMIN"], operationName: "Client PUT" }
  );
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  return withAuthorizedRoute(
    request,
    async () => {
      const service = new ClientsService(getClientsRepository());
      await service.remove(id);
      return NextResponse.json({ success: true });
    },
    { roles: ["ADMIN"], operationName: "Client DELETE" }
  );
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = await authorizedRequest.json();
      const { action, orderId, orderItemId, amount, method, adminPassword, reason } = body;
      const service = new ClientsService(getClientsRepository());

      if (action === "correct_debt" && amount !== undefined && adminPassword && reason) {
        const result = await service.correctDebt({ clientId: id, amount, adminPassword, reason });
        return NextResponse.json(result);
      }

      if (action === "pay_cascading" && amount) {
        const result = await service.payCascading({
          clientId: id,
          amount,
          method,
          receivedByUserId: user.uid,
        });
        return NextResponse.json(result);
      }

      if (action === "pay_order" && orderId) {
        const result = await service.payOrder({
          clientId: id,
          orderId,
          amount,
          method,
          receivedByUserId: user.uid,
        });
        return NextResponse.json(result);
      }

      if (action === "remove_order_item" && orderId && orderItemId) {
        const result = await service.removeOrderItem({ clientId: id, orderId, orderItemId });
        return NextResponse.json(result);
      }

      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    },
    { roles: ["ADMIN"], operationName: "Client PATCH" }
  );
}
