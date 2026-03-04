import { NextRequest, NextResponse } from "next/server";
import { getStoreSettings, updateStoreSettings } from "@/lib/db";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async () => {
      const settings = await getStoreSettings();
      return NextResponse.json(settings);
    },
    { operationName: "Settings GET" }
  );
}

export async function PUT(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const body = await authorizedRequest.json();
      const { storeName, address, phone, cnpj, footerMessage, exchangeDays, discounts } = body;

      const settings = await updateStoreSettings({
        storeName,
        address,
        phone,
        cnpj,
        footerMessage,
        exchangeDays,
        discounts,
      });

      return NextResponse.json(settings);
    },
    { roles: ["ADMIN"], operationName: "Settings PUT" }
  );
}
