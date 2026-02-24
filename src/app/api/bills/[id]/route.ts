import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

function toCompetencyMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

async function assertBillPaidMonthOpenOrUnpaid(billData: { status?: string; paidAt?: unknown }) {
  if (billData.status !== "PAID") return;

  const paidAtRaw = billData.paidAt as { toDate?: () => Date } | null | undefined;
  const paidAt = paidAtRaw?.toDate ? paidAtRaw.toDate() : null;
  if (!paidAt) return;

  const paidMonth = toCompetencyMonth(paidAt);
  const closure = await adminDb.collection("financialClosures").doc(paidMonth).get();
  if (closure.exists) {
    throw new Error(`Financial month ${paidMonth} is closed`);
  }
}

function mapBillMethodToFinancial(method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX") {
  if (method === "DINHEIRO") return "cash";
  if (method === "PIX") return "pix";
  if (method === "CREDITO") return "credit";
  return "debit";
}

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

      await adminDb.runTransaction(async (tx) => {
        const monthKey = toCompetencyMonth(now);
        const closureSnap = await tx.get(adminDb.collection("financialClosures").doc(monthKey));
        if (closureSnap.exists) {
          throw new Error(`Financial month ${monthKey} is closed`);
        }

        const billSnap = await tx.get(ref);
        if (!billSnap.exists) {
          throw new Error("Bill not found");
        }

        const current = billSnap.data() as { status?: string; amount?: number; name?: string };
        if (current?.status === "PAID") {
          return;
        }

        const paidAt = Timestamp.fromDate(now);
        tx.update(ref, {
          status: "PAID",
          paidAt,
          paidMethod: safeMethod,
          updatedAt: paidAt,
        });

        const amount = Number(current?.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) {
          return;
        }

        const movementRef = adminDb.collection("financialMovements").doc();
        tx.set(movementRef, {
          type: "OPERATING_EXPENSE",
          direction: "OUT",
          amount,
          paymentMethod: mapBillMethodToFinancial(safeMethod),
          relatedEntity: { kind: "bill", id: params.id },
          occurredAt: paidAt,
          competencyMonth: monthKey,
          createdBy: user.uid,
          metadata: {
            billName: current?.name || "",
            paidMethod: safeMethod,
          },
        });
      });

      const updated = await ref.get();
      return NextResponse.json({ id: updated.id, ...updated.data() });
    }

    if (action === "mark_unpaid") {
      await assertBillPaidMonthOpenOrUnpaid(doc.data() as { status?: string; paidAt?: unknown });

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

    const billDoc = await adminDb.collection("bills").doc(params.id).get();
    if (!billDoc.exists) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    await assertBillPaidMonthOpenOrUnpaid(billDoc.data() as { status?: string; paidAt?: unknown });

    await adminDb.collection("bills").doc(params.id).delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting bill:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
