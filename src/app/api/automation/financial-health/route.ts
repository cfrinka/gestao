import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth-api";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { FinancialService } from "@/domains/financial/financial-service";
import { getFinancialRepository } from "@/domains/financial/financial-repository-factory";

export const dynamic = "force-dynamic";

async function resolveActor(request: NextRequest): Promise<{ uid: string; email: string; role: string } | null> {
  const cronSecret = request.headers.get("x-automation-secret") || "";
  const configuredSecret = process.env.FINANCIAL_AUTOMATION_SECRET || "";

  if (configuredSecret && cronSecret && cronSecret === configuredSecret) {
    return { uid: "automation", email: "", role: "SYSTEM" };
  }

  return verifyAuth(request);
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ user }) => {
      const service = new FinancialService(getFinancialRepository());
      const result = await service.runHealthCheck({ actorId: user.uid, actorRole: user.role });
      return NextResponse.json(result);
    },
    {
      roles: ["ADMIN", "SYSTEM"],
      operationName: "automation financial-health post",
      authorize: resolveActor,
    }
  );
}
