import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { getExchangeInsights } from "@/domains/reports/sales-insights";

export const dynamic = "force-dynamic";

/** What comes back on exchanges: products, sizes returned and size-for-size swaps. */
export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const days = Number(new URL(authorizedRequest.url).searchParams.get("days") || 90);
      return NextResponse.json(await getExchangeInsights(days));
    },
    { roles: ["ADMIN"], operationName: "Exchange insights report GET", cache: { scope: "shared" } }
  );
}
