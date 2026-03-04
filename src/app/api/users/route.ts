import { NextRequest, NextResponse } from "next/server";
import { getUsers } from "@/lib/db";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async () => {
      const users = await getUsers();
      return NextResponse.json(users);
    },
    { roles: ["ADMIN"], operationName: "Users GET" }
  );
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const body = await authorizedRequest.json();
      const { email, password, name, role } = body;

      if (!email || !password || !name || !role) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      const firebaseUser = await adminAuth.createUser({
        email,
        password,
        displayName: name,
      });

      const now = new Date();
      await adminDb.collection("users").doc(firebaseUser.uid).set({
        email,
        name,
        role,
        createdAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      });

      return NextResponse.json(
        {
          id: firebaseUser.uid,
          email,
          name,
          role,
          createdAt: now,
          updatedAt: now,
        },
        { status: 201 }
      );
    },
    { roles: ["ADMIN"], operationName: "Users POST" }
  );
}
