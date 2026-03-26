import { NextRequest } from "next/server";
import { adminAuth, adminDb } from "./firebase-admin";

interface AuthUser {
  uid: string;
  email: string;
  role: string;
  authTime?: number;
}

export async function verifyAuth(request: NextRequest): Promise<AuthUser | null> {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return null;
    }

    const token = authHeader.split("Bearer ")[1];
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
      role: normalizedRole,
      authTime: typeof decodedToken.auth_time === "number" ? decodedToken.auth_time : undefined,
    };
  } catch (error) {
    console.error("Auth verification failed:", error);
    return null;
  }
}

export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
