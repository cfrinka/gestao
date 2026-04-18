import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

interface EntryInfo {
  id: string;
  productName: string;
  sku: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  source: string;
  time: string;
  createdByName: string;
}

interface DayGroup {
  date: string;
  total: number;
  quantity: number;
  entries: EntryInfo[];
}

function parseDateFilter(value: string | null, boundary: "start" | "end"): Date | undefined {
  if (!value) return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const isoValue = boundary === "start" ? `${value}T00:00:00.000` : `${value}T23:59:59.999`;
    const parsed = new Date(isoValue);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;

  if (boundary === "start") {
    parsed.setHours(0, 0, 0, 0);
  } else {
    parsed.setHours(23, 59, 59, 999);
  }

  return parsed;
}

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const { searchParams } = new URL(authorizedRequest.url);
      const startDate = parseDateFilter(searchParams.get("startDate"), "start");
      const endDate = parseDateFilter(searchParams.get("endDate"), "end");

      const now = new Date();
      const defaultStart = startDate || new Date(now.getFullYear(), now.getMonth(), 1);
      const defaultEnd = endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      let entriesDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      try {
        const snapshot = await adminDb
          .collection("stockPurchases")
          .where("createdAt", ">=", Timestamp.fromDate(defaultStart))
          .where("createdAt", "<=", Timestamp.fromDate(defaultEnd))
          .orderBy("createdAt", "asc")
          .get();
        entriesDocs = snapshot.docs;
      } catch (err) {
        console.error("[stock-entries] query failed:", err);
        throw err;
      }

      const byDay = new Map<string, DayGroup>();
      let monthTotal = 0;
      let monthQuantity = 0;

      entriesDocs.forEach((doc) => {
        const data = doc.data();
        const createdAt: Date = data.createdAt?.toDate?.() || new Date();
        const date = createdAt.toLocaleDateString("pt-BR");
        const quantity = Number(data.quantity || 0);
        const unitCost = Number(data.unitCost || 0);
        const totalCost = Number(data.totalCost || quantity * unitCost);

        if (!byDay.has(date)) {
          byDay.set(date, { date, total: 0, quantity: 0, entries: [] });
        }

        const group = byDay.get(date)!;
        group.entries.push({
          id: doc.id,
          productName: String(data.productName || "Produto"),
          sku: String(data.sku || ""),
          quantity,
          unitCost,
          totalCost,
          source: String(data.source || ""),
          time: createdAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
          createdByName: String(data.createdByName || ""),
        });
        group.total += totalCost;
        group.quantity += quantity;

        monthTotal += totalCost;
        monthQuantity += quantity;
      });

      const days: DayGroup[] = Array.from(byDay.values())
        .sort((a, b) => {
          const da = new Date(a.date.split("/").reverse().join("-"));
          const db = new Date(b.date.split("/").reverse().join("-"));
          return da.getTime() - db.getTime();
        })
        .map((g) => ({
          ...g,
          entries: g.entries.sort((a, b) => a.time.localeCompare(b.time)),
        }));

      return NextResponse.json({
        period: {
          start: defaultStart.toLocaleDateString("pt-BR"),
          end: defaultEnd.toLocaleDateString("pt-BR"),
        },
        monthTotal,
        monthQuantity,
        days,
      });
    },
    { roles: ["ADMIN"], operationName: "Stock Entries GET" }
  );
}
