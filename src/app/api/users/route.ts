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
        isActive: true,
        deactivatedAt: null,
        deactivatedBy: null,
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

export async function PUT(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const body = await authorizedRequest.json();
      const { id, role } = body as { id?: string; role?: string };

      if (!id || !role) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      if (role !== "ADMIN" && role !== "CASHIER") {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }

      const userRef = adminDb.collection("users").doc(id);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      const now = new Date();
      await userRef.update({
        role,
        updatedAt: Timestamp.fromDate(now),
      });

      const updatedData = userSnap.data() as { email?: string; name?: string };
      return NextResponse.json({
        id,
        email: updatedData?.email || "",
        name: updatedData?.name || "",
        role,
        updatedAt: now,
      });
    },
    { roles: ["ADMIN"], operationName: "Users PUT" }
  );
}

export async function DELETE(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const { searchParams } = new URL(authorizedRequest.url);
      const id = searchParams.get("id");

      if (!id) {
        return NextResponse.json({ error: "Missing user id" }, { status: 400 });
      }

      if (id === user.uid) {
        return NextResponse.json({ error: "You cannot deactivate your own user" }, { status: 400 });
      }

      const userRef = adminDb.collection("users").doc(id);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      const now = new Date();
      await Promise.all([
        userRef.update({
          isActive: false,
          deactivatedAt: Timestamp.fromDate(now),
          deactivatedBy: user.uid,
          updatedAt: Timestamp.fromDate(now),
        }),
        adminAuth.updateUser(id, { disabled: true }),
      ]);

      return NextResponse.json({ ok: true });
    },
    { roles: ["ADMIN"], operationName: "Users DELETE" }
  );
}
