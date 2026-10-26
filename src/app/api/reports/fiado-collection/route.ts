import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { getFiadoCollectionReport } from "@/domains/reports/operational-reports";

export const dynamic = "force-dynamic";

/** Clients who owe, oldest debt first, with what is needed to contact them. */
export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async () => NextResponse.json(await getFiadoCollectionReport()),
    { roles: ["ADMIN"], operationName: "Fiado collection report GET", cache: { scope: "shared" } }
  );
}
