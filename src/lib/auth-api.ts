import { NextRequest } from "next/server";
import { adminAuth, adminDb } from "./firebase-admin";
import { cached } from "./server-cache";

interface AuthUser {
  uid: string;
  email: string;
  name: string;
  role: string;
  authTime?: number;
  isDemo?: boolean;
}

interface UserAccess {
  name?: string;
  role?: string;
  isActive?: boolean;
  isDemo?: boolean;
}

/**
 * The user's access record. Kept in the server cache, so a page that fires several requests
 * (the POS asks for products, register, settings and clients at once) reads it once — and any
 * write, including a role change or a deactivation, drops it so the next request rereads it.
 */
function getUserAccess(uid: string): Promise<UserAccess | null> {
  return cached(
    `auth-user:${uid}`,
    async () => {
      const userDoc = await adminDb.collection("users").doc(uid).get();
      return userDoc.exists ? ((userDoc.data() || {}) as UserAccess) : null;
    },
    5 * 60 * 1000
  );
}

export async function verifyAuth(request: NextRequest): Promise<AuthUser | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.split("Bearer ")[1];

  try {
    // Signature and expiry are checked locally against Google's cached public keys.
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userData = await getUserAccess(decodedToken.uid);

    // A valid Firebase token alone is not access: every account the store uses is created
    // from the Usuários screen, which writes this doc. Anything else (a self-registered
    // account, a leftover test login) gets nothing.
    if (!userData) {
      return null;
    }

    if (userData.isActive === false) {
      return null;
    }

    const rawRole = userData.role || "CASHIER";
    const normalizedRole = rawRole === "OWNER" ? "ADMIN" : rawRole;

    return {
      uid: decodedToken.uid,
      email: decodedToken.email || "",
      name: String(userData.name || decodedToken.email || decodedToken.uid),
      role: normalizedRole,
      authTime: typeof decodedToken.auth_time === "number" ? decodedToken.auth_time : undefined,
      isDemo: userData.isDemo === true,
    };
  } catch (error) {
    console.error("Auth verification failed:", error);
    return null;
  }
}

export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: "Sessão expirada ou acesso não autorizado. Entre novamente." }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
