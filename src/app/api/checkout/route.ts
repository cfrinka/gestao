import { NextRequest, NextResponse } from "next/server";
import { processCheckout, PaymentMethod, getOpenCashRegister, updateCashRegisterSales, getClient, updateClientBalance } from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";
import { adminDb } from "@/lib/firebase-admin";

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
  idempotencyKey?: string;
}

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    const body: CheckoutBody = await request.json();
    const { items, payments, discount, clientId, payLater, idempotencyKey } = body;

    const safeIdempotencyKey = (idempotencyKey || "").trim();
    if (!safeIdempotencyKey) {
      return NextResponse.json({ error: "idempotencyKey is required" }, { status: 400 });
    }

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "No items in cart" }, { status: 400 });
    }

    // Only ADMIN can apply discounts or use pay later
    const canUseAdvancedFeatures = user.role === "ADMIN";
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

    const idempotencyRef = adminDb
      .collection("idempotencyKeys")
      .doc(`checkout:${user.uid}:${safeIdempotencyKey}`);

    const requestHash = JSON.stringify({
      items,
      payments: payLater ? [] : (payments || []),
      discount: allowedDiscount,
      clientId: payLater ? clientId : undefined,
      payLater: Boolean(payLater),
      userId: user.uid,
    });

    const idempotencyCheck = await adminDb.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
      const snap = await tx.get(idempotencyRef);
      if (snap.exists) {
        return { exists: true, data: snap.data() as Record<string, unknown> };
      }

      tx.create(idempotencyRef, {
        scope: "checkout",
        ownerId: user.uid,
        key: safeIdempotencyKey,
        requestHash,
        status: "PROCESSING",
        createdAt: new Date(),
      });
      return { exists: false, data: null };
    });

    if (idempotencyCheck.exists) {
      const existingHash = String(idempotencyCheck.data?.requestHash || "");
      if (existingHash !== requestHash) {
        return NextResponse.json({ error: "Idempotency key reuse with different payload" }, { status: 409 });
      }

      const status = String(idempotencyCheck.data?.status || "");
      if (status === "COMPLETED" && idempotencyCheck.data?.response) {
        return NextResponse.json(idempotencyCheck.data.response as unknown, { status: 200 });
      }

      return NextResponse.json({ error: "Request already being processed" }, { status: 409 });
    }

    const order = await processCheckout(
      items,
      payLater ? [] : (payments || []),
      allowedDiscount,
      payLater ? clientId : undefined,
      payLater ? clientName : undefined,
      payLater || false,
      user.uid,
      user.role
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
    
    await idempotencyRef.set(
      {
        status: "COMPLETED",
        completedAt: new Date(),
        response: JSON.parse(JSON.stringify(order)),
      },
      { merge: true }
    );

    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    console.error("Checkout error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
