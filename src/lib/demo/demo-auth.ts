import { NextRequest } from "next/server";
import type { AuthUser } from "@/lib/auth-api";
import { DEMO_COOKIE_NAME, verifyDemoCookie } from "@/lib/demo/demo-cookie";
import { getDemoSession } from "@/lib/demo/demo-store";

export const DEMO_ADMIN_UID = "demo-admin";
export const DEMO_CASHIER_UID = "demo-cashier";
export const DEMO_ADMIN_EMAIL = "admin@demo.com";
export const DEMO_CASHIER_EMAIL = "cashier@demo.com";

export function demoUidForRole(role: "ADMIN" | "CASHIER"): string {
  return role === "ADMIN" ? DEMO_ADMIN_UID : DEMO_CASHIER_UID;
}

export function demoEmailForRole(role: "ADMIN" | "CASHIER"): string {
  return role === "ADMIN" ? DEMO_ADMIN_EMAIL : DEMO_CASHIER_EMAIL;
}

export function demoNameForRole(role: "ADMIN" | "CASHIER"): string {
  return role === "ADMIN" ? "Ana (Admin Demo)" : "Carlos (Caixa Demo)";
}

/**
 * Demo-mode replacement for verifyAuth's Firebase token verification. Reads and verifies the
 * signed `demo_session` cookie, looks up the session in the in-memory store, and returns a
 * synthetic AuthUser. Never imports firebase-admin, so a demo deployment needs no real Firebase
 * credentials for auth at all.
 *
 * Deliberately does NOT set `isDemo: true` — that flag is a separate, pre-existing mechanism
 * (see withAuthorizedRoute) that silently no-ops writes for a real Firestore-backed demo
 * account. This session's writes are already safe (in-memory, per-session), so they should go
 * through normally.
 */
export async function verifyDemoAuth(request: NextRequest): Promise<AuthUser | null> {
  const raw = request.cookies.get(DEMO_COOKIE_NAME)?.value;
  const payload = verifyDemoCookie(raw);
  if (!payload) return null;

  const session = getDemoSession(payload.sid);
  if (!session) return null;

  return {
    uid: payload.uid,
    email: demoEmailForRole(payload.role),
    role: payload.role,
    authTime: Math.floor(payload.iat / 1000),
    sessionId: payload.sid,
  };
}
