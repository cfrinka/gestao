import { NextRequest, NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { DEMO_COOKIE_NAME, signDemoCookie } from "@/lib/demo/demo-cookie";
import { createDemoSession } from "@/lib/demo/demo-store";
import { buildSeedDataset } from "@/lib/demo/build-seed-dataset";
import { demoEmailForRole, demoNameForRole, demoUidForRole } from "@/lib/demo/demo-auth";

export const dynamic = "force-dynamic";

const COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

export async function POST(request: NextRequest) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { role?: unknown };
  const role = body.role === "ADMIN" ? "ADMIN" : body.role === "CASHIER" ? "CASHIER" : null;
  if (!role) {
    return NextResponse.json({ error: "role must be ADMIN or CASHIER" }, { status: 400 });
  }

  const dataset = await buildSeedDataset();
  const sessionId = createDemoSession(role, dataset);
  const uid = demoUidForRole(role);
  const email = demoEmailForRole(role);
  const name = demoNameForRole(role);

  const token = signDemoCookie({ sid: sessionId, uid, role, iat: Date.now() });

  const response = NextResponse.json({ uid, email, role, name });
  response.cookies.set(DEMO_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
