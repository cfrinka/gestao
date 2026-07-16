import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { ClientsService } from "@/domains/clients/clients-service";
import { FirestoreClientsRepository } from "@/domains/clients/firestore-clients-repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  return withAuthorizedRoute(
    request,
    async () => {
      const service = new ClientsService(new FirestoreClientsRepository());
      const client = await service.get(params.id);
      return NextResponse.json(client);
    },
    { roles: ["ADMIN"], operationName: "Client GET" }
  );
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const body = await authorizedRequest.json();
      const service = new ClientsService(new FirestoreClientsRepository());
      const updatedClient = await service.update({
        clientId: params.id,
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

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  return withAuthorizedRoute(
    request,
    async () => {
      const service = new ClientsService(new FirestoreClientsRepository());
      await service.remove(params.id);
      return NextResponse.json({ success: true });
    },
    { roles: ["ADMIN"], operationName: "Client DELETE" }
  );
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = await authorizedRequest.json();
      const { action, orderId, orderItemId, amount, method, adminPassword, reason } = body;
      const service = new ClientsService(new FirestoreClientsRepository());

      if (action === "correct_debt" && amount !== undefined && adminPassword && reason) {
        const result = await service.correctDebt({ clientId: params.id, amount, adminPassword, reason });
        return NextResponse.json(result);
      }

      if (action === "pay_cascading" && amount) {
        const result = await service.payCascading({
          clientId: params.id,
          amount,
          method,
          receivedByUserId: user.uid,
        });
        return NextResponse.json(result);
      }

      if (action === "pay_order" && orderId) {
        const result = await service.payOrder({
          clientId: params.id,
          orderId,
          amount,
          method,
          receivedByUserId: user.uid,
        });
        return NextResponse.json(result);
      }

      if (action === "remove_order_item" && orderId && orderItemId) {
        const result = await service.removeOrderItem({ clientId: params.id, orderId, orderItemId });
        return NextResponse.json(result);
      }

      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    },
    { roles: ["ADMIN"], operationName: "Client PATCH" }
  );
}
