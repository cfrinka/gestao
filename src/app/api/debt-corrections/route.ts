import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest
) {
  return withAuthorizedRoute(
    request,
    async () => {
      const correctionsQuery = adminDb
        .collection("debtCorrections")
        .orderBy("createdAt", "desc")
        .limit(100); // Limit to last 100 corrections
      
      const correctionsSnap = await correctionsQuery.get();
      const corrections = correctionsSnap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          clientId: data.clientId,
          clientName: data.clientName || "Cliente",
          correctionAmount: data.correctionAmount || 0,
          previousBalance: data.previousBalance || 0,
          newBalance: data.newBalance || 0,
          reason: data.reason || "",
          createdAt: data.createdAt?.toDate()?.toISOString() || new Date().toISOString(),
          competencyMonth: data.competencyMonth || "",
        };
      });

      return NextResponse.json(corrections);
    },
    { roles: ["ADMIN"], operationName: "Debt Corrections GET" }
  );
}
