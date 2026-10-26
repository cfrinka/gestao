import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { getSalesInsights } from "@/domains/reports/sales-insights";

export const dynamic = "force-dynamic";

/** Sales by weekday and hour, per seller, discounts, categories and returning customers. */
export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const days = Number(new URL(authorizedRequest.url).searchParams.get("days") || 30);
      return NextResponse.json(await getSalesInsights(days));
    },
    { roles: ["ADMIN"], operationName: "Sales insights report GET", cache: { scope: "shared" } }
  );
}
