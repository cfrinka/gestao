import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

function toCompetencyMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function mapBillMethodToFinancial(method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX") {
  if (method === "DINHEIRO") return "cash";
  if (method === "PIX") return "pix";
  if (method === "CREDITO") return "credit";
  return "debit";
}

/**
 * Reads (but does not write) the live OPERATING_EXPENSE movement for a paid bill, and asserts
 * that the month it was paid in isn't already closed. Must be called before any writes in the
 * same transaction (Firestore requires all reads before any write).
 */
async function readBillExpenseMovementForReversal(
  tx: FirebaseFirestore.Transaction,
  billId: string,
  billData: { status?: string; paidAt?: unknown }
): Promise<FirebaseFirestore.QueryDocumentSnapshot | undefined> {
  if (billData.status !== "PAID") return undefined;

  const paidAtRaw = billData.paidAt as { toDate?: () => Date } | null | undefined;
  const paidAt = paidAtRaw?.toDate ? paidAtRaw.toDate() : null;
  if (paidAt) {
    const paidMonth = toCompetencyMonth(paidAt);
    const closureSnap = await tx.get(adminDb.collection("financialClosures").doc(paidMonth));
    if (closureSnap.exists) {
      throw new Error(`Financial month ${paidMonth} is closed`);
    }
  }

  const movementsSnap = await tx.get(
    adminDb
      .collection("financialMovements")
      .where("type", "==", "OPERATING_EXPENSE")
      .where("relatedEntity.id", "==", billId)
      .limit(1)
  );
  return movementsSnap.docs[0];
}

function reverseBillExpenseMovement(
  tx: FirebaseFirestore.Transaction,
  movementDoc: FirebaseFirestore.QueryDocumentSnapshot,
  actorId: string,
  nowTs: Timestamp
) {
  tx.update(movementDoc.ref, {
    amount: 0,
    metadata: {
      ...(movementDoc.data().metadata || {}),
      reversed: true,
      reversedAt: nowTs,
      reversedBy: actorId,
    },
  });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = (await authorizedRequest.json().catch(() => ({}))) as Record<string, unknown>;
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
        await adminDb.runTransaction(async (tx) => {
          const billSnap = await tx.get(ref);
          if (!billSnap.exists) {
            throw new Error("Bill not found");
          }
          const current = billSnap.data() as { status?: string; paidAt?: unknown };
          const movementDoc = await readBillExpenseMovementForReversal(tx, params.id, current);

          // ALL WRITES AFTER ALL READS
          const nowTs = Timestamp.fromDate(now);
          tx.update(ref, {
            status: "PENDING",
            paidAt: null,
            paidMethod: null,
            updatedAt: nowTs,
          });

          if (movementDoc) {
            reverseBillExpenseMovement(tx, movementDoc, user.uid, nowTs);
          }
        });

        const updated = await ref.get();
        return NextResponse.json({ id: updated.id, ...updated.data() });
      }

      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    },
    { roles: ["ADMIN"], operationName: "Bills PATCH" }
  );
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  return withAuthorizedRoute(
    request,
    async ({ user }) => {
      const ref = adminDb.collection("bills").doc(params.id);

      await adminDb.runTransaction(async (tx) => {
        const billSnap = await tx.get(ref);
        if (!billSnap.exists) {
          throw new Error("Bill not found");
        }
        const current = billSnap.data() as { status?: string; paidAt?: unknown };
        const movementDoc = await readBillExpenseMovementForReversal(tx, params.id, current);

        // ALL WRITES AFTER ALL READS
        if (movementDoc) {
          reverseBillExpenseMovement(tx, movementDoc, user.uid, Timestamp.fromDate(new Date()));
        }
        tx.delete(ref);
      });

      return NextResponse.json({ ok: true });
    },
    { roles: ["ADMIN"], operationName: "Bills DELETE" }
  );
}
