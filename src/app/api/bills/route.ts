import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { BillsService } from "@/domains/bills/bills-service";
import { FirestoreBillsRepository } from "@/domains/bills/firestore-bills-repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const { searchParams } = new URL(authorizedRequest.url);
      const month = searchParams.get("month");
      const status = (searchParams.get("status") || "all").toLowerCase();

      const service = new BillsService(new FirestoreBillsRepository());
      const bills = await service.list({ month, status });
      return NextResponse.json(bills);
    },
    { roles: ["ADMIN"], operationName: "Bills GET" }
  );
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = (await authorizedRequest.json().catch(() => ({}))) as Record<string, unknown>;

      const service = new BillsService(new FirestoreBillsRepository());
      const result = await service.create({
        userId: user.uid,
        idempotencyKey: String(body.idempotencyKey || ""),
        kind: body.kind,
        name: body.name,
        amount: body.amount,
        dayOfMonth: body.dayOfMonth,
        monthsAhead: body.monthsAhead,
        startMonth: body.startMonth,
        dueDate: body.dueDate,
        firstDueDate: body.firstDueDate,
        installmentsCount: body.installmentsCount,
        intervalMonths: body.intervalMonths,
      });

      return NextResponse.json(result.body, { status: result.status });
    },
    { roles: ["ADMIN"], operationName: "Bills POST" }
  );
}
