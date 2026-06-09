import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const body = await authorizedRequest.json();
      const { updates } = body;

      if (!Array.isArray(updates) || updates.length === 0) {
        return NextResponse.json({ error: "No updates provided" }, { status: 400 });
      }

      const batch = adminDb.batch();
      const now = Timestamp.fromDate(new Date());

      for (const { id, category } of updates) {
        if (!id) continue;
        const ref = adminDb.collection("products").doc(id);
        batch.update(ref, {
          category: category || null,
          updatedAt: now,
        });
      }

      await batch.commit();

      return NextResponse.json({ updated: updates.length });
    },
    { roles: ["ADMIN"], operationName: "Products Bulk Category PATCH" }
  );
}
