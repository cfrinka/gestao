import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { isAdminPasswordRateLimited, recordAdminPasswordAttempt, verifyAdminPassword } from "@/lib/admin-password";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const { adminPassword } = await authorizedRequest.json();

      if (!adminPassword) {
        return NextResponse.json({ error: "Admin password is required" }, { status: 400 });
      }

      if (await isAdminPasswordRateLimited(user.uid)) {
        return NextResponse.json(
          { error: "Muitas tentativas incorretas. Tente novamente em alguns minutos." },
          { status: 429 }
        );
      }

      const isValid = await verifyAdminPassword(adminPassword);
      await recordAdminPasswordAttempt(user.uid, isValid);

      if (!isValid) {
        return NextResponse.json({ error: "Invalid admin password" }, { status: 403 });
      }

      return NextResponse.json({ success: true });
    },
    { operationName: "Admin Password Verify", allowDemoWrite: true }
  );
}
