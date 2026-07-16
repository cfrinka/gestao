import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { CashRegisterService } from "@/domains/cash-register/cash-register-service";
import { getCashRegisterRepository } from "@/domains/cash-register/cash-register-repository-factory";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ user }) => {
      const service = new CashRegisterService(getCashRegisterRepository());
      const register = await service.getOpen(user.uid);
      return NextResponse.json({ register });
    },
    { operationName: "CashRegister GET" }
  );
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = await authorizedRequest.json();
      const { action, openingBalance, closingBalance, amount, note, idempotencyKey } = body;

      const service = new CashRegisterService(getCashRegisterRepository());

      if (action === "open") {
        const register = await service.open(user.uid, user.email, Number(openingBalance || 0));
        return NextResponse.json({ register }, { status: 201 });
      }

      if (action === "close") {
        const result = await service.close(user.uid, Number(closingBalance || 0));
        return NextResponse.json(result);
      }

      if (action === "supply" || action === "withdrawal") {
        const result = await service.adjust({
          userId: user.uid,
          idempotencyKey: String(idempotencyKey || ""),
          type: action === "supply" ? "SUPPLY" : "WITHDRAWAL",
          amount,
          note,
          actorId: user.uid,
          actorRole: user.role,
        });
        return NextResponse.json(result.body, { status: result.status });
      }

      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    },
    { operationName: "CashRegister POST" }
  );
}
