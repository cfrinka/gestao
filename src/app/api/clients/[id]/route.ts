import { NextRequest, NextResponse } from "next/server";
import { getClient, updateClient, deleteClient, getClientPendingOrders, updateClientBalance, markOrderAsPaid } from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    if (user.role !== "ADMIN" && user.role !== "OWNER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const client = await getClient(params.id);
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const pendingOrders = await getClientPendingOrders(params.id);
    return NextResponse.json({ ...client, pendingOrders });
  } catch (error) {
    console.error("Error fetching client:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    if (user.role !== "ADMIN" && user.role !== "OWNER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const client = await getClient(params.id);
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, phone, email, notes } = body;

    await updateClient(params.id, { name, phone, email, notes });
    const updatedClient = await getClient(params.id);
    return NextResponse.json(updatedClient);
  } catch (error) {
    console.error("Error updating client:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    if (user.role !== "ADMIN" && user.role !== "OWNER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const client = await getClient(params.id);
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    if (client.balance !== 0) {
      return NextResponse.json({ error: "Cannot delete client with pending balance" }, { status: 400 });
    }

    await deleteClient(params.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting client:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    if (user.role !== "ADMIN" && user.role !== "OWNER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const client = await getClient(params.id);
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const { action, orderId, amount } = body;

    if (action === "pay_order" && orderId) {
      const pendingOrders = await getClientPendingOrders(params.id);
      const order = pendingOrders.find(o => o.id === orderId);
      
      if (!order) {
        return NextResponse.json({ error: "Order not found or already paid" }, { status: 404 });
      }

      await markOrderAsPaid(orderId);
      await updateClientBalance(params.id, -order.totalAmount);
      
      const updatedClient = await getClient(params.id);
      return NextResponse.json(updatedClient);
    }

    if (action === "adjust_balance" && amount !== undefined) {
      await updateClientBalance(params.id, amount);
      const updatedClient = await getClient(params.id);
      return NextResponse.json(updatedClient);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Error patching client:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
