import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";

export const dynamic = "force-dynamic";

type ProductSize = { size: string; stock: number };

type MigrationCounters = {
  scanned: number;
  updated: number;
  skipped: number;
  errors: number;
  sampleUpdatedIds: string[];
};

type MigrationResult = {
  products: MigrationCounters;
  orderItems: MigrationCounters;
  orders: MigrationCounters;
  exchanges: MigrationCounters;
  totalScanned: number;
  totalUpdated: number;
  totalSkipped: number;
  totalErrors: number;
};

function parseLimit(value: unknown): number {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return 2000;
  return Math.min(10000, n);
}

function parseApply(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return value === "true" || value === "1";
}

function createCounters(): MigrationCounters {
  return {
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    sampleUpdatedIds: [],
  };
}

function pushSample(counter: MigrationCounters, id: string) {
  if (counter.sampleUpdatedIds.length < 25) {
    counter.sampleUpdatedIds.push(id);
  }
}

function isPPSize(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value.trim().toUpperCase() === "PP";
}

function normalizeSizes(value: unknown): ProductSize[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((v) => {
      const obj = v as Record<string, unknown>;
      const size = typeof obj?.size === "string" ? obj.size.trim() : "";
      const stockRaw = typeof obj?.stock === "number" ? obj.stock : parseInt(String(obj?.stock ?? "0"), 10);
      const stock = Number.isFinite(stockRaw) ? Math.max(0, stockRaw) : 0;
      return { size, stock };
    })
    .filter((s) => Boolean(s.size));
}

function remapProductSizesToTU(sizes: ProductSize[]): { nextSizes: ProductSize[]; changed: boolean } {
  if (!Array.isArray(sizes) || sizes.length === 0) {
    return { nextSizes: [], changed: false };
  }

  const sizeToStock = new Map<string, number>();
  let changed = false;

  for (const entry of sizes) {
    const rawSize = (entry.size || "").trim();
    const upperRaw = rawSize.toUpperCase();
    const nextSize = upperRaw === "PP" ? "TU" : rawSize;

    if (nextSize !== rawSize) {
      changed = true;
    }

    const prev = sizeToStock.get(nextSize) ?? 0;
    sizeToStock.set(nextSize, prev + (Number.isFinite(entry.stock) ? entry.stock : 0));
  }

  const preferredOrder = ["TU", "P", "M", "G", "GG", "XG", "G1", "G2", "G3"];
  const ordered: ProductSize[] = [];

  for (const size of preferredOrder) {
    const stock = sizeToStock.get(size);
    if (stock !== undefined) {
      ordered.push({ size, stock });
      sizeToStock.delete(size);
    }
  }

  for (const [size, stock] of Array.from(sizeToStock.entries())) {
    ordered.push({ size, stock });
  }

  if (!changed && ordered.length === sizes.length) {
    for (let i = 0; i < ordered.length; i += 1) {
      const a = ordered[i];
      const b = sizes[i];
      if (!b || a.size !== b.size || a.stock !== b.stock) {
        changed = true;
        break;
      }
    }
  } else {
    changed = true;
  }

  return { nextSizes: ordered, changed };
}

async function runMigration(apply: boolean, limitPerCollection: number): Promise<MigrationResult> {
  const result: MigrationResult = {
    products: createCounters(),
    orderItems: createCounters(),
    orders: createCounters(),
    exchanges: createCounters(),
    totalScanned: 0,
    totalUpdated: 0,
    totalSkipped: 0,
    totalErrors: 0,
  };

  let batch = adminDb.batch();
  let batchOps = 0;

  const commitBatch = async () => {
    if (!apply || batchOps === 0) return;
    await batch.commit();
    batch = adminDb.batch();
    batchOps = 0;
  };

  const registerScanned = (counter: MigrationCounters) => {
    counter.scanned += 1;
    result.totalScanned += 1;
  };

  const registerSkipped = (counter: MigrationCounters) => {
    counter.skipped += 1;
    result.totalSkipped += 1;
  };

  const registerUpdated = (counter: MigrationCounters, id: string) => {
    counter.updated += 1;
    result.totalUpdated += 1;
    pushSample(counter, id);
  };

  const registerError = (counter: MigrationCounters) => {
    counter.errors += 1;
    result.totalErrors += 1;
  };

  const queueUpdate = async (
    ref: FirebaseFirestore.DocumentReference,
    data: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>
  ) => {
    if (!apply) return;
    batch.update(ref, data);
    batchOps += 1;
    if (batchOps >= 400) {
      await commitBatch();
    }
  };

  const processCollection = async (
    collectionName: string,
    counter: MigrationCounters,
    onDoc: (doc: FirebaseFirestore.QueryDocumentSnapshot) => Promise<boolean>
  ) => {
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    let scannedInCollection = 0;

    while (scannedInCollection < limitPerCollection) {
      const remaining = limitPerCollection - scannedInCollection;
      let query: FirebaseFirestore.Query = adminDb
        .collection(collectionName)
        .orderBy(FieldPath.documentId())
        .limit(Math.min(400, remaining));

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();
      if (snapshot.empty) break;

      for (const doc of snapshot.docs) {
        registerScanned(counter);
        scannedInCollection += 1;

        try {
          const changed = await onDoc(doc);
          if (changed) {
            registerUpdated(counter, doc.id);
          } else {
            registerSkipped(counter);
          }
        } catch {
          registerError(counter);
        }
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.docs.length < Math.min(400, remaining)) {
        break;
      }
    }
  };

  await processCollection("products", result.products, async (doc) => {
    const data = doc.data() as Record<string, unknown>;
    const currentSizes = normalizeSizes(data.sizes);
    const { nextSizes, changed } = remapProductSizesToTU(currentSizes);
    if (!changed) return false;

    const nextStock = nextSizes.reduce((sum, s) => sum + (Number.isFinite(s.stock) ? s.stock : 0), 0);
    await queueUpdate(doc.ref, {
      sizes: nextSizes,
      stock: nextStock,
      updatedAt: Timestamp.fromDate(new Date()),
    });
    return true;
  });

  await processCollection("orderItems", result.orderItems, async (doc) => {
    const data = doc.data() as Record<string, unknown>;
    const currentSize = data.size;
    if (!isPPSize(currentSize)) return false;

    await queueUpdate(doc.ref, {
      size: "TU",
    });
    return true;
  });

  await processCollection("orders", result.orders, async (doc) => {
    const data = doc.data() as Record<string, unknown>;
    const items = Array.isArray(data.items) ? data.items : [];
    if (!Array.isArray(items) || items.length === 0) return false;

    let changed = false;
    const nextItems = items.map((item) => {
      const asObj = item as Record<string, unknown>;
      if (!isPPSize(asObj.size)) return asObj;
      changed = true;
      return { ...asObj, size: "TU" };
    });

    if (!changed) return false;

    await queueUpdate(doc.ref, {
      items: nextItems,
      updatedAt: Timestamp.fromDate(new Date()),
    });
    return true;
  });

  await processCollection("exchanges", result.exchanges, async (doc) => {
    const data = doc.data() as Record<string, unknown>;
    const items = Array.isArray(data.items) ? data.items : [];
    if (!Array.isArray(items) || items.length === 0) return false;

    let changed = false;
    const nextItems = items.map((item) => {
      const asObj = item as Record<string, unknown>;
      if (!isPPSize(asObj.size)) return asObj;
      changed = true;
      return { ...asObj, size: "TU" };
    });

    if (!changed) return false;

    await queueUpdate(doc.ref, {
      items: nextItems,
    });
    return true;
  });

  await commitBatch();

  return result;
}

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const { searchParams } = new URL(authorizedRequest.url);
      const apply = parseApply(searchParams.get("apply"));
      const limitPerCollection = parseLimit(searchParams.get("limitPerCollection"));

      const result = await runMigration(apply, limitPerCollection);
      return NextResponse.json({ apply, limitPerCollection, ...result });
    },
    { roles: ["ADMIN"], operationName: "admin migrate-pp-to-tu get" }
  );
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const body = (await authorizedRequest.json().catch(() => ({}))) as {
        apply?: boolean;
        limitPerCollection?: number;
      };
      const apply = parseApply(body.apply);
      const limitPerCollection = parseLimit(body.limitPerCollection);

      const result = await runMigration(apply, limitPerCollection);
      return NextResponse.json({ apply, limitPerCollection, ...result });
    },
    { roles: ["ADMIN"], operationName: "admin migrate-pp-to-tu post" }
  );
}
