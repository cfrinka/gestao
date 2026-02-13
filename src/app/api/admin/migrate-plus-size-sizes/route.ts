import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

type ProductSize = { size: string; stock: number };

type MigrateResult = {
  scanned: number;
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

function normalizeSizes(value: unknown): ProductSize[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      const obj = v as Record<string, unknown>;
      const size = typeof obj?.size === "string" ? obj.size : "";
      const stock = typeof obj?.stock === "number" ? obj.stock : parseInt(String(obj?.stock ?? "0"), 10);
      return { size, stock: Number.isFinite(stock) ? Math.max(0, stock) : 0 };
    })
    .filter((s) => Boolean(s.size));
}

function remapPlusSizes(sizes: ProductSize[]): { nextSizes: ProductSize[]; changed: boolean } {
  const mapping: Record<string, string> = { P: "G1", M: "G2", G: "G3" };
  const stockBySize = new Map<string, number>();
  let changed = false;

  for (const s of sizes) {
    const rawSize = (s.size || "").toUpperCase().trim();
    const nextSize = mapping[rawSize] ?? rawSize;
    if (nextSize !== rawSize) changed = true;

    const prev = stockBySize.get(nextSize) ?? 0;
    stockBySize.set(nextSize, prev + (typeof s.stock === "number" ? s.stock : 0));
  }

  const preferredOrder = ["GG", "XG", "G1", "G2", "G3"]; 
  const ordered: ProductSize[] = [];

  for (const size of preferredOrder) {
    const stock = stockBySize.get(size);
    if (stock !== undefined) {
      ordered.push({ size, stock });
      stockBySize.delete(size);
    }
  }

  for (const [size, stock] of Array.from(stockBySize.entries())) {
    ordered.push({ size, stock });
  }

  if (ordered.length !== sizes.length) {
    changed = true;
  }

  return { nextSizes: ordered, changed };
}

async function runMigration(apply: boolean, limit: number): Promise<MigrateResult> {
  const snapshot = await adminDb
    .collection("products")
    .where("plusSized", "==", true)
    .limit(limit)
    .get();

  const result: MigrateResult = {
    scanned: snapshot.size,
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
      const currentSizes = normalizeSizes(data.sizes);
      const { nextSizes, changed } = remapPlusSizes(currentSizes);

      if (!changed) {
        result.skipped += 1;
        continue;
      }

      const nextStock = nextSizes.reduce((sum, s) => sum + (typeof s.stock === "number" ? s.stock : 0), 0);

      if (apply) {
        batch.update(doc.ref, { sizes: nextSizes, stock: nextStock });
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
