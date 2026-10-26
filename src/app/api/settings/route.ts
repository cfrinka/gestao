import { NextRequest, NextResponse } from "next/server";
import { getStoreSettings, updateStoreSettings } from "@/domains/settings/settings-db";
import { discountSettingsSchema } from "@/domains/settings/discount-settings-schema";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { HttpError } from "@/lib/api/http-errors";
import { roundMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

/** A number setting the request may leave out; out of range is refused with `message`. */
function optionalNumber(value: unknown, min: number, max: number, message: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new HttpError(400, message);
  return number;
}

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async () => {
      const settings = await getStoreSettings();
      return NextResponse.json(settings);
    },
    { operationName: "Settings GET", cache: { scope: "shared" } }
  );
}

export async function PUT(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const body = await authorizedRequest.json();
      const { storeName, address, phone, cnpj, footerMessage, exchangeDays, discounts, commissionPercent } = body;

      if (commissionPercent !== undefined) {
        const percent = Number(commissionPercent);
        if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
          throw new HttpError(400, "A comissão precisa ficar entre 0% e 100%");
        }
      }

      const fiadoLimit = optionalNumber(body.fiadoLimit, 0, 1_000_000, "O limite de fiado precisa ser um valor em reais (0 = sem limite)");
      const fiadoMaxDays = optionalNumber(body.fiadoMaxDays, 0, 365, "O prazo do fiado precisa ficar entre 0 e 365 dias");
      const registerDifferenceLimit = optionalNumber(
        body.registerDifferenceLimit,
        0,
        100_000,
        "A diferença de caixa tolerada precisa ser um valor em reais"
      );

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
        ...(commissionPercent !== undefined ? { commissionPercent: Number(commissionPercent) } : {}),
        ...(fiadoLimit !== undefined ? { fiadoLimit: roundMoney(fiadoLimit) } : {}),
        ...(fiadoMaxDays !== undefined ? { fiadoMaxDays: Math.floor(fiadoMaxDays) } : {}),
        ...(registerDifferenceLimit !== undefined ? { registerDifferenceLimit: roundMoney(registerDifferenceLimit) } : {}),
      });

      return NextResponse.json(settings);
    },
    { roles: ["ADMIN"], operationName: "Settings PUT" }
  );
}
