import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { generateReports } from "@/domains/reports/reports-service";
import { generateDemoReports } from "@/domains/reports/demo-reports-service";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { getDemoSessionId } from "@/lib/demo/demo-context";
import { getDemoDataset } from "@/lib/demo/demo-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const { searchParams } = new URL(authorizedRequest.url);
      const startDateRaw = searchParams.get("startDate");
      const endDateRaw = searchParams.get("endDate");

      const demoSessionId = isDemoMode() ? getDemoSessionId() : null;
      if (demoSessionId) {
        const dataset = getDemoDataset(demoSessionId);
        if (dataset) {
          const result = await generateDemoReports({
            role: user.role,
            startDateRaw,
            endDateRaw,
            dataset,
          });
          return NextResponse.json(result.payload);
        }
      }

      const forceRefreshParam = (searchParams.get("forceRefresh") || "").toLowerCase();
      const forceRefresh = forceRefreshParam === "1" || forceRefreshParam === "true";
      const debugParam = (searchParams.get("debug") || "").toLowerCase();
      const debugMode = debugParam === "1" || debugParam === "true";

      const result = await generateReports({
        role: user.role,
        startDateRaw,
        endDateRaw,
        forceRefresh,
        debugMode,
      });

      return NextResponse.json(result.payload);
    },
    { roles: ["ADMIN"], operationName: "Reports GET" }
  );
}
