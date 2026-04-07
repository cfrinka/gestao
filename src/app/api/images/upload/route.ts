import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";
import { getAdminApp } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const productId = formData.get("productId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed." },
        { status: 400 }
      );
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB." },
        { status: 400 }
      );
    }

    const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
    if (!bucketName) {
      console.error("FIREBASE_STORAGE_BUCKET environment variable is not set");
      return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
    }

    const storage = getStorage(getAdminApp());
    const bucket = storage.bucket(bucketName);

    // Generate filename - use productId if provided (for overwriting), otherwise generate unique name
    const extension = file.name.split(".").pop() || "jpg";
    const filename = productId 
      ? `produtos/${productId}.${extension}`
      : `produtos/${Date.now()}-${Math.random().toString(36).substring(7)}.${extension}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileRef = bucket.file(filename);

    await fileRef.save(buffer, {
      metadata: {
        contentType: file.type,
      },
    });

    const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 365 * 10;
    const [readUrl] = await fileRef.getSignedUrl({
      action: "read",
      expires: expiresAt,
    });

    return NextResponse.json({ url: readUrl });
  } catch (error) {
    console.error("Error uploading image:", error);
    const message = error instanceof Error ? error.message : "Failed to upload image";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
