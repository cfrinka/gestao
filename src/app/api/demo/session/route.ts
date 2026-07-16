import { NextRequest, NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { verifyDemoAuth, demoNameForRole } from "@/lib/demo/demo-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const user = await verifyDemoAuth(request);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  return NextResponse.json({
    uid: user.uid,
    email: user.email,
    role: user.role,
    name: demoNameForRole(user.role as "ADMIN" | "CASHIER"),
  });
}
