import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { CashRegisterService } from "@/domains/cash-register/cash-register-service";
import { FirestoreCashRegisterRepository } from "@/domains/cash-register/firestore-cash-register-repository";
import { getStoreSettingsCached } from "@/domains/settings/settings-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ user }) => {
      const service = new CashRegisterService(new FirestoreCashRegisterRepository());
      const register = await service.getOpen(user.uid);
      return NextResponse.json({ register });
    },
    { operationName: "CashRegister GET", cache: { scope: "user" } }
  );
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = await authorizedRequest.json();
      const { action, openingBalance, closingBalance, amount, note, differenceNote, idempotencyKey } = body;

      const service = new CashRegisterService(new FirestoreCashRegisterRepository());

      if (action === "open") {
        const register = await service.open(user.uid, user.email, Number(openingBalance || 0));
        return NextResponse.json({ register }, { status: 201 });
      }

      if (action === "close") {
        const settings = await getStoreSettingsCached();
        const result = await service.close(user.uid, Number(closingBalance || 0), {
          note: differenceNote,
          tolerance: Number(settings.registerDifferenceLimit ?? 10),
        });
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

      return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
    },
    { operationName: "CashRegister POST" }
  );
}
