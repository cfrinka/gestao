import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { CommissionService } from "@/domains/comission/comission-service";
import { getCommissionRepository } from "@/domains/comission/comission-repository-factory";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ user }) => {
      const service = new CommissionService(getCommissionRepository());
      const result = await service.sync(user.role);
      return NextResponse.json(result);
    },
    { roles: ["ADMIN"], operationName: "Comission Sync" }
  );
}

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ user }) => {
      const service = new CommissionService(getCommissionRepository());
      const report = await service.getReport(user.uid, user.role);
      return NextResponse.json(report);
    },
    { roles: ["ADMIN", "CASHIER"], operationName: "Comission GET" }
  );
}
