import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { getStagnantStockReport } from "@/domains/reports/operational-reports";

export const dynamic = "force-dynamic";

/** Products in stock with no sale for 30 days or more, and the money tied up in them. */
export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async () => NextResponse.json(await getStagnantStockReport()),
    { roles: ["ADMIN"], operationName: "Stagnant stock report GET", cache: { scope: "shared" } }
  );
}
