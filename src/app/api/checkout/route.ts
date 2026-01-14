import { NextRequest, NextResponse } from "next/server";
import { processCheckout, PaymentMethod } from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

interface CartItem {
  productId: string;
  size: string;
  quantity: number;
}

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    const body = await request.json();
    const { items, payments }: { items: CartItem[]; payments?: PaymentMethod[] } = body;

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "No items in cart" }, { status: 400 });
    }

    const order = await processCheckout(items, payments || []);
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    console.error("Checkout error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
