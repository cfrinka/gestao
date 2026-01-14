import { NextRequest, NextResponse } from "next/server";
import { getOwners, createOwner } from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    const owners = await getOwners();
    return NextResponse.json(owners);
  } catch (error) {
    console.error("Error fetching owners:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const owner = await createOwner(name);
    return NextResponse.json(owner, { status: 201 });
  } catch (error) {
    console.error("Error creating owner:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
