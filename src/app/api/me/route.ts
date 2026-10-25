import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { cached } from "@/lib/server-cache";

export const dynamic = "force-dynamic";

/**
 * Who is signed in and whether they may use the system. Unlike the other routes this answers a
 * missing or deactivated access record with a reason instead of a bare 401, so the login screen
 * can say why. Reads the same cached record as every authorized request.
 */
export async function GET(request: NextRequest) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return NextResponse.json({ access: "signed_out" }, { status: 401 });
  }

  let uid: string;
  let email: string;
  try {
    const decoded = await adminAuth.verifyIdToken(header.slice("Bearer ".length));
    uid = decoded.uid;
    email = decoded.email || "";
  } catch {
    return NextResponse.json({ access: "signed_out" }, { status: 401 });
  }

  const record = await cached(
    `auth-user:${uid}`,
    async () => {
      const doc = await adminDb.collection("users").doc(uid).get();
      return doc.exists ? ((doc.data() || {}) as { name?: string; role?: string; isActive?: boolean; isDemo?: boolean }) : null;
    },
    5 * 60 * 1000
  ).catch(() => undefined);

  if (record === undefined) {
    return NextResponse.json({ access: "unknown" }, { status: 503 });
  }
  if (record === null) {
    return NextResponse.json({ access: "missing" });
  }
  if (record.isActive === false) {
    return NextResponse.json({ access: "inactive" });
  }

  const role = record.role === "OWNER" ? "ADMIN" : record.role === "ADMIN" ? "ADMIN" : "CASHIER";
  return NextResponse.json({
    access: "ok",
    user: { id: uid, email, name: String(record.name || email || uid), role },
  });
}
