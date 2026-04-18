import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

interface AdjustmentBody {
  productId?: string;
  delta?: number;
  sizeAdjustments?: Array<{ size: string; delta: number }>;
  reason?: string;
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = (await authorizedRequest.json()) as AdjustmentBody;
      const productId = String(body.productId || "").trim();
      const delta = Number(body.delta || 0);
      const reason = String(body.reason || "").trim();
      const sizeAdjustments = Array.isArray(body.sizeAdjustments) ? body.sizeAdjustments : [];

      if (!productId) {
        return NextResponse.json({ error: "productId is required" }, { status: 400 });
      }
      if (!Number.isFinite(delta) || (delta === 0 && sizeAdjustments.length === 0)) {
        return NextResponse.json({ error: "delta must be non-zero" }, { status: 400 });
      }
      if (!reason) {
        return NextResponse.json({ error: "reason is required" }, { status: 400 });
      }

      const productRef = adminDb.collection("products").doc(productId);
      const adjustmentRef = adminDb.collection("stockAdjustments").doc();

      const result = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(productRef);
        if (!snap.exists) {
          throw new Error("Product not found");
        }
        const product = snap.data() as {
          name?: string;
          sku?: string;
          stock?: number;
          sizes?: Array<{ size: string; stock: number }>;
        };

        const previousStock = Number(product.stock || 0);
        const nextStock = Math.max(0, previousStock + Math.trunc(delta));
        const appliedDelta = nextStock - previousStock;

        const previousSizes = Array.isArray(product.sizes) ? product.sizes : [];
        let nextSizes = previousSizes;
        const appliedSizeAdjustments: Array<{ size: string; delta: number; before: number; after: number }> = [];

        if (sizeAdjustments.length > 0) {
          const sizeMap = new Map(previousSizes.map((s) => [s.size, Number(s.stock || 0)]));
          for (const adj of sizeAdjustments) {
            const sizeKey = String(adj.size || "").trim();
            const sizeDelta = Math.trunc(Number(adj.delta || 0));
            if (!sizeKey || sizeDelta === 0) continue;
            const before = sizeMap.get(sizeKey) || 0;
            const after = Math.max(0, before + sizeDelta);
            sizeMap.set(sizeKey, after);
            appliedSizeAdjustments.push({ size: sizeKey, delta: after - before, before, after });
          }
          nextSizes = Array.from(sizeMap.entries()).map(([size, stock]) => ({ size, stock }));
        }

        tx.update(productRef, {
          stock: nextStock,
          sizes: nextSizes,
          updatedAt: Timestamp.fromDate(new Date()),
        });

        tx.set(adjustmentRef, {
          productId,
          productName: String(product.name || ""),
          sku: String(product.sku || ""),
          previousStock,
          nextStock,
          delta: appliedDelta,
          sizeAdjustments: appliedSizeAdjustments,
          reason,
          createdById: user.uid,
          createdByName: user.email || user.uid,
          createdAt: Timestamp.fromDate(new Date()),
        });

        return { previousStock, nextStock, appliedDelta };
      });

      return NextResponse.json({
        id: adjustmentRef.id,
        ...result,
      });
    },
    { roles: ["ADMIN"], operationName: "Stock Adjustment POST" }
  );
}

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async () => {
      const snapshot = await adminDb
        .collection("stockAdjustments")
        .orderBy("createdAt", "desc")
        .limit(100)
        .get();

      const items = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate?.() || new Date(),
        };
      });

      return NextResponse.json(items);
    },
    { roles: ["ADMIN"], operationName: "Stock Adjustment GET" }
  );
}
