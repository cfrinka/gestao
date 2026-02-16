import { NextRequest, NextResponse } from "next/server";
import { createExchange, getExchanges } from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

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
  items: ExchangeItemBody[];
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

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "Adicione ao menos um item na troca" }, { status: 400 });
    }

    const exchange = await createExchange({
      documentNumber: body.documentNumber,
      customerName: body.customerName,
      notes: body.notes,
      items: body.items,
      createdById: user.uid,
      createdByName: user.email || user.uid,
    });

    return NextResponse.json(exchange, { status: 201 });
  } catch (error) {
    console.error("Error creating exchange:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
