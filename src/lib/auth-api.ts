import { NextRequest } from "next/server";
import { adminAuth, adminDb } from "./firebase-admin";

interface AuthUser {
  uid: string;
  email: string;
  name: string;
  role: string;
  authTime?: number;
  isDemo?: boolean;
}

async function verifyAuthUncached(token: string): Promise<AuthUser | null> {
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);

    // Fetch user data from Firestore to get role and ownerId
    const userDoc = await adminDb.collection("users").doc(decodedToken.uid).get();
    const userData = userDoc.data();

    if (userData?.isActive === false) {
      return null;
    }

    const rawRole = userData?.role || "CASHIER";
    const normalizedRole = rawRole === "OWNER" ? "ADMIN" : rawRole;

    return {
      uid: decodedToken.uid,
      email: decodedToken.email || "",
      name: String(userData?.name || decodedToken.email || decodedToken.uid),
      role: normalizedRole,
      authTime: typeof decodedToken.auth_time === "number" ? decodedToken.auth_time : undefined,
      isDemo: userData?.isDemo === true,
    };
  } catch (error) {
    console.error("Auth verification failed:", error);
    return null;
  }
}

// A single page load fires several API calls at once (e.g. the POS screen requests
// products, cash register, store settings and clients in parallel), and each call
// would otherwise independently re-verify the same ID token and re-read the same
// Firestore user doc. Coalesce same-token verifications within a short window so that
// burst pays for one verification instead of N. The window is short enough that an
// admin flipping isActive/role takes effect almost immediately on subsequent requests.
const AUTH_CACHE_TTL_MS = 5000;
const authCache = new Map<string, { promise: Promise<AuthUser | null>; expiresAt: number }>();

function pruneExpiredAuthCacheEntries(now: number) {
  authCache.forEach((value, key) => {
    if (value.expiresAt <= now) {
      authCache.delete(key);
    }
  });
}

export async function verifyAuth(request: NextRequest): Promise<AuthUser | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.split("Bearer ")[1];

  const now = Date.now();
  const cached = authCache.get(token);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  pruneExpiredAuthCacheEntries(now);
  const promise = verifyAuthUncached(token);
  authCache.set(token, { promise, expiresAt: now + AUTH_CACHE_TTL_MS });
  return promise;
}

export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
