import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { getRegisterDifferencesReport } from "@/domains/reports/register-differences";

export const dynamic = "force-dynamic";

/** Cash counted at each closing against what the drawer should have held, per operator. */
export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const days = Number(new URL(authorizedRequest.url).searchParams.get("days") || 90);
      return NextResponse.json(await getRegisterDifferencesReport(days));
    },
    { roles: ["ADMIN"], operationName: "Register differences report GET", cache: { scope: "shared" } }
  );
}
