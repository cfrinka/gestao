import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { ClientsService } from "@/domains/clients/clients-service";
import { getClientsRepository } from "@/domains/clients/clients-repository-factory";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async () => {
      const service = new ClientsService(getClientsRepository());
      const clients = await service.list();
      return NextResponse.json(clients);
    },
    { roles: ["ADMIN"], operationName: "Clients GET" }
  );
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const body = await authorizedRequest.json();
      const service = new ClientsService(getClientsRepository());
      const client = await service.create({
        name: body.name,
        phone: body.phone,
        email: body.email,
        notes: body.notes,
      });
      return NextResponse.json(client, { status: 201 });
    },
    { roles: ["ADMIN"], operationName: "Clients POST" }
  );
}
