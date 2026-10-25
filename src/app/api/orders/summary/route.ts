import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { getOrdersSummary } from "@/domains/orders/orders-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async () => NextResponse.json(await getOrdersSummary(8)),
    { operationName: "Orders summary GET", cache: { scope: "shared" } }
  );
}
