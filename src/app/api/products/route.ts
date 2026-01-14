import { NextRequest, NextResponse } from "next/server";
import { getProducts, getProductBySku, createProduct, getOwner } from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    const { searchParams } = new URL(request.url);
    let ownerId = searchParams.get("ownerId") || undefined;

    // Non-admin users can only see their own products
    if (user.role === "OWNER" && user.ownerId) {
      ownerId = user.ownerId;
    }

    const products = await getProducts(ownerId);
    
    const productsWithOwner = await Promise.all(
      products.map(async (product) => {
        const owner = await getOwner(product.ownerId);
        return { ...product, owner };
      })
    );

    return NextResponse.json(productsWithOwner);
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
    const { name, sku, ownerId, costPrice, salePrice, stock, sizes } = body;

    if (!name || !sku || !ownerId || costPrice === undefined || salePrice === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const existingProduct = await getProductBySku(sku);
    if (existingProduct) {
      return NextResponse.json({ error: "SKU already exists" }, { status: 400 });
    }

    const product = await createProduct({
      name,
      sku,
      ownerId,
      costPrice: parseFloat(costPrice),
      salePrice: parseFloat(salePrice),
      stock: parseInt(stock) || 0,
      sizes: sizes || [],
    });

    const owner = await getOwner(ownerId);
    return NextResponse.json({ ...product, owner }, { status: 201 });
  } catch (error) {
    console.error("Error creating product:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
