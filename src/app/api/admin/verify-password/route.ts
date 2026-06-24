import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { adminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const body = await authorizedRequest.json();
      const { adminUid } = body;

      if (!adminUid || typeof adminUid !== "string") {
        return NextResponse.json({ error: "Admin UID is required" }, { status: 400 });
      }

      try {
        // Verify that the provided UID belongs to an admin user
        const userDoc = await adminDb.collection("users").doc(adminUid).get();
        
        if (!userDoc.exists) {
          return NextResponse.json({ error: "Admin user not found" }, { status: 404 });
        }

        const userData = userDoc.data();
        if (userData?.role !== "ADMIN") {
          return NextResponse.json({ error: "User is not an admin" }, { status: 403 });
        }

        return NextResponse.json({ 
          success: true,
          isAdmin: true 
        });
      } catch (error) {
        console.error("Admin verification error:", error);
        return NextResponse.json({ error: "Verification failed" }, { status: 500 });
      }
    },
    { operationName: "Admin Verify Password" }
  );
}
