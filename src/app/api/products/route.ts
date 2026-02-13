import { NextRequest, NextResponse } from "next/server";
import { getProducts, getProductBySku, createProduct } from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    const products = await getProducts();
    return NextResponse.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    // Only ADMIN can create products
    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { name, sku, costPrice, salePrice, stock, sizes, plusSized } = body;

    if (!name || !sku || costPrice === undefined || salePrice === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const existingProduct = await getProductBySku(sku);
    if (existingProduct) {
      return NextResponse.json({ error: "SKU already exists" }, { status: 400 });
    }

    const product = await createProduct({
      name,
      sku,
      plusSized: plusSized === true,
      costPrice: parseFloat(costPrice),
      salePrice: parseFloat(salePrice),
      stock: parseInt(stock) || 0,
      sizes: sizes || [],
    });

    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    console.error("Error creating product:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
