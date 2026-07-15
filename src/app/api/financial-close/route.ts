import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { FinancialService } from "@/domains/financial/financial-service";
import { FirestoreFinancialRepository } from "@/domains/financial/firestore-financial-repository";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = (await authorizedRequest.json().catch(() => ({}))) as { month?: string };

      const service = new FinancialService(new FirestoreFinancialRepository());
      const result = await service.closeMonth({
        month: (body.month || "").trim(),
        actorId: user.uid,
        actorRole: user.role,
      });

      return NextResponse.json(result, { status: 201 });
    },
    { roles: ["ADMIN"], operationName: "Financial Close POST" }
  );
}
