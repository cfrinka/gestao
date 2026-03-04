import { NextRequest, NextResponse } from "next/server";
import { getClients, createClient } from "@/lib/db";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async () => {
      const clients = await getClients();
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
      const { name, phone, email, notes } = body;

      if (!name) {
        return NextResponse.json({ error: "Name is required" }, { status: 400 });
      }

      const client = await createClient({ name, phone, email, notes });
      return NextResponse.json(client, { status: 201 });
    },
    { roles: ["ADMIN"], operationName: "Clients POST" }
  );
}
