import { NextRequest, NextResponse } from "next/server";
import { createExchange, getExchanges, getOpenCashRegister } from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";
import { adminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

interface ExchangeItemBody {
  productId: string;
  size?: string;
  quantity: number;
  direction: "IN" | "OUT";
}

interface CreateExchangeBody {
  documentNumber?: string;
  customerName?: string;
  notes?: string;
  paymentMethod?: "cash" | "pix" | "credit" | "debit";
  items: ExchangeItemBody[];
  idempotencyKey?: string;
}

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    const { searchParams } = new URL(request.url);
    const requestedLimit = parseInt(searchParams.get("limit") || "50", 10);
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : 50;
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const parsedStartDate = startDate ? new Date(startDate) : undefined;
    const parsedEndDate = endDate ? new Date(endDate) : undefined;

    const hasValidRange =
      parsedStartDate instanceof Date &&
      !Number.isNaN(parsedStartDate.getTime()) &&
      parsedEndDate instanceof Date &&
      !Number.isNaN(parsedEndDate.getTime());

    const exchanges = await getExchanges(
      limit,
      hasValidRange ? parsedStartDate : undefined,
      hasValidRange ? parsedEndDate : undefined
    );
    return NextResponse.json(exchanges);
  } catch (error) {
    console.error("Error fetching exchanges:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    const body = (await request.json()) as CreateExchangeBody;

    const safeIdempotencyKey = (body.idempotencyKey || "").trim();
    if (!safeIdempotencyKey) {
      return NextResponse.json({ error: "idempotencyKey is required" }, { status: 400 });
    }

    if (user.role !== "ADMIN" && user.role !== "CASHIER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "Adicione ao menos um item na troca" }, { status: 400 });
    }

    const idempotencyRef = adminDb
      .collection("idempotencyKeys")
      .doc(`exchange:${user.uid}:${safeIdempotencyKey}`);

    const requestHash = JSON.stringify({
      customerName: body.customerName || "",
      notes: body.notes || "",
      paymentMethod: body.paymentMethod || "",
      items: body.items,
      userId: user.uid,
    });

    const idempotencyCheck = await adminDb.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
      const snap = await tx.get(idempotencyRef);
      if (snap.exists) {
        return { exists: true, data: snap.data() as Record<string, unknown> };
      }

      tx.create(idempotencyRef, {
        scope: "exchange",
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

    const openRegister = await getOpenCashRegister(user.uid);

    const exchange = await createExchange({
      documentNumber: body.documentNumber,
      customerName: body.customerName,
      notes: body.notes,
      paymentMethod: body.paymentMethod,
      items: body.items,
      cashRegisterId: openRegister?.id,
      createdById: user.uid,
      createdByRole: user.role,
      createdByName: user.email || user.uid,
    });

    await idempotencyRef.set(
      {
        status: "COMPLETED",
        completedAt: new Date(),
        response: JSON.parse(JSON.stringify(exchange)),
      },
      { merge: true }
    );

    return NextResponse.json(exchange, { status: 201 });
  } catch (error) {
    console.error("Error creating exchange:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
