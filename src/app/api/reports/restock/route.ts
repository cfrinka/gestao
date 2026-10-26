import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { getRestockReport } from "@/domains/reports/operational-reports";

export const dynamic = "force-dynamic";

/** Sales and stock by size, and what to reorder, from the last 30, 60 or 90 days of sales. */
export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const days = Number(new URL(authorizedRequest.url).searchParams.get("days") || 30);
      return NextResponse.json(await getRestockReport(days));
    },
    { roles: ["ADMIN"], operationName: "Restock report GET", cache: { scope: "shared" } }
  );
}
