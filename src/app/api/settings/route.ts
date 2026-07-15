import { NextRequest, NextResponse } from "next/server";
import { getStoreSettings, updateStoreSettings } from "@/domains/settings/settings-db";
import { discountSettingsSchema } from "@/domains/settings/discount-settings-schema";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { HttpError } from "@/lib/api/http-errors";

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

      if (discounts !== undefined) {
        const result = discountSettingsSchema.safeParse(discounts);
        if (!result.success) {
          throw new HttpError(400, result.error.issues[0]?.message || "Configurações de desconto inválidas");
        }
      }

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
