import { NextRequest, NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { DEMO_COOKIE_NAME, verifyDemoCookie } from "@/lib/demo/demo-cookie";
import { deleteDemoSession } from "@/lib/demo/demo-store";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const raw = request.cookies.get(DEMO_COOKIE_NAME)?.value;
  const payload = verifyDemoCookie(raw);
  if (payload) {
    deleteDemoSession(payload.sid);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(DEMO_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
