import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { setAdminPassword } from "@/lib/admin-password";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest
) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const { adminPassword } = await authorizedRequest.json();

      if (!adminPassword || typeof adminPassword !== "string" || adminPassword.length < 4) {
        return NextResponse.json({ error: "Senha deve ter pelo menos 4 caracteres" }, { status: 400 });
      }

      try {
        await setAdminPassword(adminPassword);
        return NextResponse.json({ success: true, message: "Senha de administrador definida com sucesso" });
      } catch (error) {
        console.error("Error setting admin password:", error);
        return NextResponse.json({ error: "Erro ao definir senha" }, { status: 500 });
      }
    },
    { roles: ["ADMIN"], operationName: "Set Admin Password" }
  );
}
