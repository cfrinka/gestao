import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { adminPassword } = body;

    if (!adminPassword) {
      return NextResponse.json({ error: "Admin password is required" }, { status: 400 });
    }

    // Verify admin password using the same method as debt corrections
    const settingsDoc = await adminDb.collection("settings").doc("general").get();
    const settings = settingsDoc.data();
    
    if (!settings || settings.adminPassword !== adminPassword) {
      return NextResponse.json({ error: "Invalid admin password" }, { status: 403 });
    }

    return NextResponse.json({ 
      success: true
    });
  } catch (error) {
    console.error("Admin verification error:", error);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
