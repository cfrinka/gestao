import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

type MigrateResult = {
  scanned: number;
  toUpdate: number;
  updated: number;
  skipped: number;
  errors: number;
  sampleUpdatedIds: string[];
};

function parseLimit(value: string | null): number {
  const n = value ? parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 200;
  return Math.min(500, n);
}

function parseApply(value: string | null): boolean {
  return value === "true" || value === "1";
}

async function runMigration(apply: boolean, limit: number): Promise<MigrateResult> {
  const snapshot = await adminDb
    .collection("orders")
    .where("isPaidLater", "==", true)
    .limit(limit)
    .get();

  const result: MigrateResult = {
    scanned: snapshot.size,
    toUpdate: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    sampleUpdatedIds: [],
  };

  let batch = adminDb.batch();
  let batchOps = 0;

  const commitBatch = async () => {
    if (!apply || batchOps === 0) return;
    await batch.commit();
    batch = adminDb.batch();
    batchOps = 0;
  };

  for (const doc of snapshot.docs) {
    try {
      const data = doc.data() as Record<string, unknown>;

      const totalAmount = typeof data.totalAmount === "number" ? data.totalAmount : 0;
      const paidAt = data.paidAt;

      const hasAmountPaid = typeof data.amountPaid === "number";
      const hasRemainingAmount = typeof data.remainingAmount === "number";
      const hasPaymentHistory = Array.isArray(data.paymentHistory);

      if (hasAmountPaid && hasRemainingAmount && hasPaymentHistory) {
        result.skipped += 1;
        continue;
      }

      const isPaid = Boolean(paidAt);
      const amountPaid = hasAmountPaid ? (data.amountPaid as number) : isPaid ? totalAmount : 0;
      const remainingAmount = hasRemainingAmount
        ? (data.remainingAmount as number)
        : isPaid
          ? 0
          : totalAmount;
      const paymentHistory = hasPaymentHistory ? data.paymentHistory : [];

      result.toUpdate += 1;

      if (apply) {
        batch.update(doc.ref, {
          amountPaid,
          remainingAmount,
          paymentHistory,
        });
        batchOps += 1;

        if (batchOps >= 400) {
          await commitBatch();
        }

        result.updated += 1;
        if (result.sampleUpdatedIds.length < 25) {
          result.sampleUpdatedIds.push(doc.id);
        }
      }
    } catch {
      result.errors += 1;
    }
  }

  await commitBatch();

  return result;
}

export async function GET(request: NextRequest) {
  const user = await verifyAuth(request);
  if (!user) return unauthorizedResponse();
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const apply = parseApply(searchParams.get("apply"));
  const limit = parseLimit(searchParams.get("limit"));

  const result = await runMigration(apply, limit);
  return NextResponse.json({ apply, limit, ...result });
}

export async function POST(request: NextRequest) {
  const user = await verifyAuth(request);
  if (!user) return unauthorizedResponse();
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { apply?: boolean; limit?: number };
  const apply = body.apply === true;
  const limit = typeof body.limit === "number" && body.limit > 0 ? Math.min(500, body.limit) : 200;

  const result = await runMigration(apply, limit);
  return NextResponse.json({ apply, limit, ...result });
}
