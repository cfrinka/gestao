import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { ExchangesService } from "@/domains/exchanges/exchanges-service";
import { FirestoreExchangesRepository } from "@/domains/exchanges/firestore-exchanges-repository";

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
  discountAmount?: number;
  items: ExchangeItemBody[];
  idempotencyKey?: string;
}

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const { searchParams } = new URL(authorizedRequest.url);
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

      const service = new ExchangesService(new FirestoreExchangesRepository());
      const exchanges = await service.list({
        limit,
        startDate: hasValidRange ? parsedStartDate : undefined,
        endDate: hasValidRange ? parsedEndDate : undefined,
      });

      return NextResponse.json(exchanges);
    },
    { operationName: "Exchanges GET" }
  );
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = (await authorizedRequest.json()) as CreateExchangeBody;
      const service = new ExchangesService(new FirestoreExchangesRepository());

      const result = await service.create({
        userId: user.uid,
        userRole: user.role,
        userDisplayName: user.email || user.uid,
        documentNumber: body.documentNumber,
        customerName: body.customerName,
        notes: body.notes,
        paymentMethod: body.paymentMethod,
        discountAmount: body.discountAmount,
        items: body.items,
        idempotencyKey: body.idempotencyKey || "",
      });

      return NextResponse.json(result.body, { status: result.status });
    },
    { operationName: "Exchanges POST" }
  );
}
