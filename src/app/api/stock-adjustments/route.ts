import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { StockAdjustmentsService } from "@/domains/stock-adjustments/stock-adjustments-service";
import { FirestoreStockAdjustmentsRepository } from "@/domains/stock-adjustments/firestore-stock-adjustments-repository";

export const dynamic = "force-dynamic";

interface AdjustmentBody {
  productId?: string;
  delta?: number;
  sizeAdjustments?: Array<{ size: string; delta: number }>;
  reason?: string;
  idempotencyKey?: string;
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = (await authorizedRequest.json()) as AdjustmentBody;

      const service = new StockAdjustmentsService(new FirestoreStockAdjustmentsRepository());
      const result = await service.create({
        userId: user.uid,
        userName: user.email || user.uid,
        idempotencyKey: body.idempotencyKey || "",
        productId: body.productId,
        delta: body.delta,
        sizeAdjustments: body.sizeAdjustments,
        reason: body.reason,
      });

      return NextResponse.json(result.body, { status: result.status });
    },
    { roles: ["ADMIN"], operationName: "Stock Adjustment POST" }
  );
}

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async () => {
      const service = new StockAdjustmentsService(new FirestoreStockAdjustmentsRepository());
      const items = await service.list(100);
      return NextResponse.json(items);
    },
    { roles: ["ADMIN"], operationName: "Stock Adjustment GET" }
  );
}
