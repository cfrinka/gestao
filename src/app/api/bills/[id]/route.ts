import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { BillsService } from "@/domains/bills/bills-service";
import { getBillsRepository } from "@/domains/bills/bills-repository-factory";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = (await authorizedRequest.json().catch(() => ({}))) as Record<string, unknown>;
      const action = typeof body.action === "string" ? body.action : "";
      const service = new BillsService(getBillsRepository());

      if (action === "mark_paid") {
        const updated = await service.markPaid({
          billId: params.id,
          method: body.method,
          actorId: user.uid,
          actorRole: user.role,
        });
        return NextResponse.json(updated);
      }

      if (action === "mark_unpaid") {
        const updated = await service.markUnpaid({
          billId: params.id,
          actorId: user.uid,
          actorRole: user.role,
        });
        return NextResponse.json(updated);
      }

      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    },
    { roles: ["ADMIN"], operationName: "Bills PATCH" }
  );
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  return withAuthorizedRoute(
    request,
    async ({ user }) => {
      const service = new BillsService(getBillsRepository());
      await service.remove({ billId: params.id, actorId: user.uid, actorRole: user.role });
      return NextResponse.json({ ok: true });
    },
    { roles: ["ADMIN"], operationName: "Bills DELETE" }
  );
}
