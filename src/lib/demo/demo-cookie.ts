import { createHmac, timingSafeEqual } from "crypto";

export const DEMO_COOKIE_NAME = "demo_session";

export interface DemoCookiePayload {
  sid: string;
  uid: string;
  role: "ADMIN" | "CASHIER";
  iat: number;
}

function getSecret(): string {
  return process.env.DEMO_SESSION_SECRET || "demo-insecure-default-secret";
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

export function signDemoCookie(payload: DemoCookiePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyDemoCookie(raw: string | undefined | null): DemoCookiePayload | null {
  if (!raw) return null;
  const [body, signature] = raw.split(".");
  if (!body || !signature) return null;

  const expectedSignature = sign(body);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (
      typeof payload?.sid === "string" &&
      typeof payload?.uid === "string" &&
      (payload?.role === "ADMIN" || payload?.role === "CASHIER") &&
      typeof payload?.iat === "number"
    ) {
      return payload as DemoCookiePayload;
    }
    return null;
  } catch {
    return null;
  }
}
