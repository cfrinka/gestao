import { NextRequest, NextResponse } from "next/server";
import { getClient, updateClient, deleteClient, getClientPendingOrders, updateClientBalance, markOrderAsPaid, applyFiadoPayment } from "@/lib/db";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return withAuthorizedRoute(
    request,
    async () => {
      const client = await getClient(params.id);
      if (!client) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
      }

      const pendingOrders = await getClientPendingOrders(params.id);
      return NextResponse.json({ ...client, pendingOrders });
    },
    { roles: ["ADMIN"], operationName: "Client GET" }
  );
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const client = await getClient(params.id);
      if (!client) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
      }

      const body = await authorizedRequest.json();
      const { name, phone, email, notes } = body;

      await updateClient(params.id, { name, phone, email, notes });
      const updatedClient = await getClient(params.id);
      return NextResponse.json(updatedClient);
    },
    { roles: ["ADMIN"], operationName: "Client PUT" }
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return withAuthorizedRoute(
    request,
    async () => {
      const client = await getClient(params.id);
      if (!client) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
      }

      if (client.balance !== 0) {
        return NextResponse.json({ error: "Cannot delete client with pending balance" }, { status: 400 });
      }

      await deleteClient(params.id);
      return NextResponse.json({ success: true });
    },
    { roles: ["ADMIN"], operationName: "Client DELETE" }
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const client = await getClient(params.id);
      if (!client) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
      }

      const body = await authorizedRequest.json();
      const { action, orderId, amount, method } = body;

      if (action === "pay_order" && orderId) {
        const pendingOrders = await getClientPendingOrders(params.id);
        const order = pendingOrders.find(o => o.id === orderId);

        if (!order) {
          return NextResponse.json({ error: "Order not found or already paid" }, { status: 404 });
        }

        const remaining = typeof order.remainingAmount === "number" ? order.remainingAmount : order.totalAmount;
        const paymentAmount = typeof amount === "number" ? amount : parseFloat(amount);
        const finalAmount = Number.isFinite(paymentAmount) && paymentAmount > 0 ? paymentAmount : remaining;
        const finalMethod = method || "DINHEIRO";

        try {
          await applyFiadoPayment(params.id, orderId, finalAmount, finalMethod);
        } catch {
          await markOrderAsPaid(orderId);
          await updateClientBalance(params.id, -order.totalAmount);
        }

        const updatedClient = await getClient(params.id);
        const refreshedPending = await getClientPendingOrders(params.id);
        return NextResponse.json({ ...updatedClient, pendingOrders: refreshedPending });
      }

      if (action === "adjust_balance" && amount !== undefined) {
        await updateClientBalance(params.id, amount);
        const updatedClient = await getClient(params.id);
        return NextResponse.json(updatedClient);
      }

      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    },
    { roles: ["ADMIN"], operationName: "Client PATCH" }
  );
}
