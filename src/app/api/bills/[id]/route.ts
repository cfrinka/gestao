import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await verifyAuth(request);
    if (!user) return unauthorizedResponse();
    if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";

    const ref = adminDb.collection("bills").doc(params.id);
    const doc = await ref.get();

    if (!doc.exists) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    const now = new Date();

    if (action === "mark_paid") {
      const method = typeof body.method === "string" ? body.method : "DINHEIRO";
      const allowed = ["DINHEIRO", "DEBITO", "CREDITO", "PIX"] as const;
      const safeMethod = (allowed as readonly string[]).includes(method) ? (method as (typeof allowed)[number]) : "DINHEIRO";

      await ref.update({
        status: "PAID",
        paidAt: Timestamp.fromDate(now),
        paidMethod: safeMethod,
        updatedAt: Timestamp.fromDate(now),
      });

      const updated = await ref.get();
      return NextResponse.json({ id: updated.id, ...updated.data() });
    }

    if (action === "mark_unpaid") {
      await ref.update({
        status: "PENDING",
        paidAt: null,
        paidMethod: null,
        updatedAt: Timestamp.fromDate(now),
      });

      const updated = await ref.get();
      return NextResponse.json({ id: updated.id, ...updated.data() });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Error updating bill:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await verifyAuth(request);
    if (!user) return unauthorizedResponse();
    if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await adminDb.collection("bills").doc(params.id).delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting bill:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
