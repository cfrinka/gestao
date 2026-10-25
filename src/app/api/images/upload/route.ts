import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";
import { getAdminApp } from "@/lib/firebase-admin";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { HttpError } from "@/lib/api/http-errors";

export const dynamic = "force-dynamic";

// The stored extension comes from the checked MIME type, never from the uploaded file name.
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const MAX_SIZE = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const formData = await authorizedRequest.formData();
      const file = formData.get("file") as File | null;
      const rawProductId = formData.get("productId");
      const productId = typeof rawProductId === "string" ? rawProductId.trim() : "";

      if (!file) {
        throw new HttpError(400, "Nenhuma imagem enviada");
      }

      const extension = EXTENSION_BY_TYPE[file.type];
      if (!extension) {
        throw new HttpError(400, "Formato não aceito. Envie JPG, PNG, WebP ou GIF.");
      }

      if (file.size > MAX_SIZE) {
        throw new HttpError(400, "Imagem muito grande. O limite é 5 MB.");
      }

      if (productId && !/^[A-Za-z0-9_-]{1,128}$/.test(productId)) {
        throw new HttpError(400, "Produto inválido");
      }

      const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
      if (!bucketName) {
        console.error("FIREBASE_STORAGE_BUCKET environment variable is not set");
        throw new HttpError(500, "O armazenamento de imagens não está configurado.");
      }

      const bucket = getStorage(getAdminApp()).bucket(bucketName);

      // Use productId when provided (overwrites that product's photo), otherwise a unique name.
      const filename = productId
        ? `produtos/${productId}.${extension}`
        : `produtos/${Date.now()}-${Math.random().toString(36).substring(7)}.${extension}`;

      const fileRef = bucket.file(filename);
      await fileRef.save(Buffer.from(await file.arrayBuffer()), {
        metadata: { contentType: file.type },
      });

      const [readUrl] = await fileRef.getSignedUrl({
        action: "read",
        expires: Date.now() + 1000 * 60 * 60 * 24 * 365 * 10,
      });

      return NextResponse.json({ url: readUrl });
    },
    // Product photos are managed only from the admin product screens. Demo accounts are
    // read-only here like every other write.
    { roles: ["ADMIN"], operationName: "Image upload" }
  );
}
