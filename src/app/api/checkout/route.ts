import { NextRequest, NextResponse } from "next/server";
import { processCheckout, PaymentMethod, getOpenCashRegister, updateCashRegisterSales, getClient, updateClientBalance } from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

interface CartItem {
  productId: string;
  size: string;
  quantity: number;
}

interface CheckoutBody {
  items: CartItem[];
  payments?: PaymentMethod[];
  discount?: number;
  clientId?: string;
  payLater?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    const body: CheckoutBody = await request.json();
    const { items, payments, discount, clientId, payLater } = body;

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "No items in cart" }, { status: 400 });
    }

    // Only ADMIN and OWNER can apply discounts or use pay later
    const canUseAdvancedFeatures = user.role === "ADMIN" || user.role === "OWNER";
    const allowedDiscount = canUseAdvancedFeatures ? (discount || 0) : 0;

    // Validate pay later request
    let clientName: string | undefined;
    if (payLater && clientId) {
      if (!canUseAdvancedFeatures) {
        return NextResponse.json({ error: "You don't have permission to use pay later" }, { status: 403 });
      }
      const client = await getClient(clientId);
      if (!client) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
      }
      clientName = client.name;
    }

    const order = await processCheckout(
      items, 
      payLater ? [] : (payments || []), 
      allowedDiscount,
      payLater ? clientId : undefined,
      payLater ? clientName : undefined,
      payLater || false
    );

    // Update client balance if pay later
    if (payLater && clientId) {
      await updateClientBalance(clientId, order.totalAmount);
    }
    
    // Update cash register if open (only for immediate payments)
    if (!payLater) {
      const cashRegister = await getOpenCashRegister(user.uid);
      if (cashRegister && payments && payments.length > 0) {
        await updateCashRegisterSales(cashRegister.id, payments, order.totalAmount);
      }
    }
    
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    console.error("Checkout error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
