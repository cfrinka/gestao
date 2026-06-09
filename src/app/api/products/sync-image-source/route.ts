import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

function detectImageSource(imageUrl: string | undefined | null): "uploaded" | "random" | "none" {
  if (!imageUrl || imageUrl.trim() === "") return "none";
  // Firebase Storage URLs (uploaded images)
  if (
    imageUrl.includes("firebasestorage.googleapis.com") ||
    imageUrl.includes("storage.googleapis.com")
  ) {
    return "uploaded";
  }
  // Picsum/random placeholder images
  if (imageUrl.includes("picsum.photos")) {
    return "random";
  }
  // Any other URL (user pasted a custom URL) — treat as uploaded since it was intentional
  return "uploaded";
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async () => {
      const productsSnap = await adminDb.collection("products").get();
      const now = Timestamp.fromDate(new Date());

      let updated = 0;
      const batchSize = 500;
      let batch = adminDb.batch();
      let batchCount = 0;

      for (const doc of productsSnap.docs) {
        const data = doc.data();
        const currentImageSource = data.imageSource;
        const image = data.image as string | undefined;
        const detected = detectImageSource(image);

        // Only update if imageSource is missing or different
        if (currentImageSource !== detected) {
          batch.update(doc.ref, { imageSource: detected, updatedAt: now });
          updated++;
          batchCount++;

          if (batchCount >= batchSize) {
            await batch.commit();
            batch = adminDb.batch();
            batchCount = 0;
          }
        }
      }

      if (batchCount > 0) {
        await batch.commit();
      }

      return NextResponse.json({
        total: productsSnap.size,
        updated,
      });
    },
    { roles: ["ADMIN"], operationName: "Products Sync Image Source" }
  );
}
