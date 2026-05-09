import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";

export const dynamic = "force-dynamic";

const DEMO_EMAIL = "teste@teste.com";
const DEMO_PASSWORD = "Teste@123";
const DEMO_NAME = "Usuário Demonstrativo";
const DEMO_ROLE = "CASHIER";

/**
 * Idempotent endpoint to provision or reset the demo user.
 * Only ADMINs can call it. Writes by the demo user are blocked in withAuthorizedRoute.
 */
export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async () => {
      let firebaseUid: string;

      try {
        const existing = await adminAuth.getUserByEmail(DEMO_EMAIL);
        firebaseUid = existing.uid;
        await adminAuth.updateUser(firebaseUid, {
          password: DEMO_PASSWORD,
          displayName: DEMO_NAME,
          disabled: false,
        });
      } catch (err) {
        const code = (err as { code?: string })?.code || "";
        if (code !== "auth/user-not-found") {
          throw err;
        }
        const created = await adminAuth.createUser({
          email: DEMO_EMAIL,
          password: DEMO_PASSWORD,
          displayName: DEMO_NAME,
        });
        firebaseUid = created.uid;
      }

      const now = new Date();
      const userRef = adminDb.collection("users").doc(firebaseUid);
      const snap = await userRef.get();

      if (snap.exists) {
        await userRef.update({
          email: DEMO_EMAIL,
          name: DEMO_NAME,
          role: DEMO_ROLE,
          isActive: true,
          isDemo: true,
          deactivatedAt: null,
          deactivatedBy: null,
          updatedAt: Timestamp.fromDate(now),
        });
      } else {
        await userRef.set({
          email: DEMO_EMAIL,
          name: DEMO_NAME,
          role: DEMO_ROLE,
          isActive: true,
          isDemo: true,
          deactivatedAt: null,
          deactivatedBy: null,
          createdAt: Timestamp.fromDate(now),
          updatedAt: Timestamp.fromDate(now),
        });
      }

      return NextResponse.json({
        ok: true,
        uid: firebaseUid,
        email: DEMO_EMAIL,
        role: DEMO_ROLE,
        isDemo: true,
        message: "Usuário demonstrativo provisionado. Credenciais: teste@teste.com / Teste@123",
      });
    },
    { roles: ["ADMIN"], operationName: "Users Demo Provision", allowDemoWrite: true }
  );
}
