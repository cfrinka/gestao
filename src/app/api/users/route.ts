import { NextRequest, NextResponse } from "next/server";
import { getUsers, getOwner } from "@/lib/db";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const users = await getUsers();
    
    const usersWithOwner = await Promise.all(
      users.map(async (user) => {
        const owner = user.ownerId ? await getOwner(user.ownerId) : null;
        return { ...user, owner };
      })
    );

    return NextResponse.json(usersWithOwner);
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await verifyAuth(request);
    if (!authUser) {
      return unauthorizedResponse();
    }

    if (authUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { email, password, name, role, ownerId } = body;

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
      ownerId: ownerId || null,
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
    });

    const owner = ownerId ? await getOwner(ownerId) : null;

    return NextResponse.json({
      id: firebaseUser.uid,
      email,
      name,
      role,
      ownerId,
      owner,
      createdAt: now,
      updatedAt: now,
    }, { status: 201 });
  } catch (error) {
    console.error("Error creating user:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
