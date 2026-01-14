import { NextRequest } from "next/server";
import { adminAuth, adminDb } from "./firebase-admin";

export interface AuthUser {
  uid: string;
  email: string;
  role: string;
  ownerId: string | null;
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
    
    return {
      uid: decodedToken.uid,
      email: decodedToken.email || "",
      role: userData?.role || "CASHIER",
      ownerId: userData?.ownerId || null,
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
