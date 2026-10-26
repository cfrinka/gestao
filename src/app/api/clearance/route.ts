import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { HttpError } from "@/lib/api/http-errors";
import { applyClearance, endClearance, getClearanceOverview } from "@/domains/clearance/clearance-db";

export const dynamic = "force-dynamic";

/** Products in stock with no sale in the last 30, 60 or 90 days, and the clearances on file. */
export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const days = Number(new URL(authorizedRequest.url).searchParams.get("days") || 30);
      return NextResponse.json(await getClearanceOverview(days));
    },
    { roles: ["ADMIN"], operationName: "Clearance GET", cache: { scope: "shared" } }
  );
}

/** { action: "apply", items: [{ productId, price }], endsAt? } or { action: "end", productIds }. */
export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const body = await authorizedRequest.json();
      if (body.action === "apply") {
        const applied = await applyClearance({ items: body.items, endsAt: body.endsAt });
        return NextResponse.json({ applied });
      }
      if (body.action === "end") {
        const ended = await endClearance(body.productIds);
        return NextResponse.json({ ended });
      }
      throw new HttpError(400, "Ação inválida");
    },
    { roles: ["ADMIN"], operationName: "Clearance POST" }
  );
}
