import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { generateReports } from "@/domains/reports/reports-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const { searchParams } = new URL(authorizedRequest.url);
      const forceRefreshParam = (searchParams.get("forceRefresh") || "").toLowerCase();
      const forceRefresh = forceRefreshParam === "1" || forceRefreshParam === "true";
      const debugParam = (searchParams.get("debug") || "").toLowerCase();
      const debugMode = debugParam === "1" || debugParam === "true";

      const result = await generateReports({
        role: user.role,
        startDateRaw: searchParams.get("startDate"),
        endDateRaw: searchParams.get("endDate"),
        forceRefresh,
        debugMode,
      });

      return NextResponse.json(result.payload);
    },
    { roles: ["ADMIN"], operationName: "Reports GET" }
  );
}
