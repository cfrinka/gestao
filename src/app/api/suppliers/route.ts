import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";
import { createSupplier, getSuppliers } from "@/lib/db";

export const dynamic = "force-dynamic";

const METHOD_VALUES = ["DINHEIRO", "DEBITO", "CREDITO", "PIX", "FIADO"] as const;

function normalizeMethods(value: unknown): (typeof METHOD_VALUES)[number][] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((v) => (typeof v === "string" ? v.toUpperCase() : ""))
    .filter((v): v is (typeof METHOD_VALUES)[number] => (METHOD_VALUES as readonly string[]).includes(v));
  return Array.from(new Set(normalized));
}

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) return unauthorizedResponse();

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const suppliers = await getSuppliers();
    return NextResponse.json(suppliers);
  } catch (error) {
    console.error("Error fetching suppliers:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) return unauthorizedResponse();

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const instagram = typeof body.instagram === "string" ? body.instagram.trim() : "";
    const whatsapp = typeof body.whatsapp === "string" ? body.whatsapp.trim() : "";
    const website = typeof body.website === "string" ? body.website.trim() : "";
    const observations = typeof body.observations === "string" ? body.observations.trim() : "";
    const acceptedPaymentMethods = normalizeMethods(body.acceptedPaymentMethods);

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const supplier = await createSupplier({
      name,
      instagram: instagram || undefined,
      whatsapp: whatsapp || undefined,
      website: website || undefined,
      observations: observations || undefined,
      acceptedPaymentMethods,
    });

    return NextResponse.json(supplier, { status: 201 });
  } catch (error) {
    console.error("Error creating supplier:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
