import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";
import { deleteSupplier, getSupplier, updateSupplier } from "@/lib/db";

export const dynamic = "force-dynamic";

const METHOD_VALUES = ["DINHEIRO", "DEBITO", "CREDITO", "PIX", "FIADO"] as const;

function normalizeMethods(value: unknown): (typeof METHOD_VALUES)[number][] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((v) => (typeof v === "string" ? v.toUpperCase() : ""))
    .filter((v): v is (typeof METHOD_VALUES)[number] => (METHOD_VALUES as readonly string[]).includes(v));
  return Array.from(new Set(normalized));
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await verifyAuth(request);
    if (!user) return unauthorizedResponse();

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supplier = await getSupplier(params.id);
    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    return NextResponse.json(supplier);
  } catch (error) {
    console.error("Error fetching supplier:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await verifyAuth(request);
    if (!user) return unauthorizedResponse();

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const existing = await getSupplier(params.id);
    if (!existing) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const name = typeof body.name === "string" ? body.name.trim() : undefined;
    const instagram = typeof body.instagram === "string" ? body.instagram.trim() : undefined;
    const whatsapp = typeof body.whatsapp === "string" ? body.whatsapp.trim() : undefined;
    const website = typeof body.website === "string" ? body.website.trim() : undefined;
    const observations = typeof body.observations === "string" ? body.observations.trim() : undefined;
    const acceptedPaymentMethods = normalizeMethods(body.acceptedPaymentMethods);

    if (name !== undefined && !name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    await updateSupplier(params.id, {
      ...(name !== undefined ? { name } : {}),
      ...(instagram !== undefined ? { instagram: instagram || undefined } : {}),
      ...(whatsapp !== undefined ? { whatsapp: whatsapp || undefined } : {}),
      ...(website !== undefined ? { website: website || undefined } : {}),
      ...(observations !== undefined ? { observations: observations || undefined } : {}),
      ...(acceptedPaymentMethods !== undefined ? { acceptedPaymentMethods } : {}),
    });

    const updated = await getSupplier(params.id);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating supplier:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await verifyAuth(request);
    if (!user) return unauthorizedResponse();

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const existing = await getSupplier(params.id);
    if (!existing) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    await deleteSupplier(params.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting supplier:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
