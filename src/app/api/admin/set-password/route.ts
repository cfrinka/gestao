import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";

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
        // Set admin password in settings/general document
        await adminDb.collection("settings").doc("general").set({
          adminPassword,
          updatedAt: new Date(),
        }, { merge: true });

        return NextResponse.json({ success: true, message: "Senha de administrador definida com sucesso" });
      } catch (error) {
        console.error("Error setting admin password:", error);
        return NextResponse.json({ error: "Erro ao definir senha" }, { status: 500 });
      }
    },
    { roles: ["ADMIN"], operationName: "Set Admin Password" }
  );
}
