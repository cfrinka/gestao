import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { BillsService } from "@/domains/bills/bills-service";
import { FirestoreBillsRepository } from "@/domains/bills/firestore-bills-repository";

type RouteContext = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = (await authorizedRequest.json().catch(() => ({}))) as Record<string, unknown>;
      const action = typeof body.action === "string" ? body.action : "";
      const service = new BillsService(new FirestoreBillsRepository());

      if (action === "mark_paid") {
        const updated = await service.markPaid({
          billId: id,
          method: body.method,
          actorId: user.uid,
          actorRole: user.role,
        });
        return NextResponse.json(updated);
      }

      if (action === "mark_unpaid") {
        const updated = await service.markUnpaid({
          billId: id,
          actorId: user.uid,
          actorRole: user.role,
        });
        return NextResponse.json(updated);
      }

      return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
    },
    { roles: ["ADMIN"], operationName: "Bills PATCH" }
  );
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  return withAuthorizedRoute(
    request,
    async ({ user }) => {
      const service = new BillsService(new FirestoreBillsRepository());
      await service.remove({ billId: id, actorId: user.uid, actorRole: user.role });
      return NextResponse.json({ ok: true });
    },
    { roles: ["ADMIN"], operationName: "Bills DELETE" }
  );
}
