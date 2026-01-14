import { NextRequest, NextResponse } from "next/server";
import { getProduct, getProductBySku, updateProduct, deleteProduct, getOwner } from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    const product = await getProduct(params.id);

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const owner = await getOwner(product.ownerId);
    return NextResponse.json({ ...product, owner });
  } catch (error) {
    console.error("Error fetching product:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { name, sku, costPrice, salePrice, stock, sizes } = body;

    const existingProduct = await getProduct(params.id);

    if (!existingProduct) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    if (sku && sku !== existingProduct.sku) {
      const skuExists = await getProductBySku(sku);
      if (skuExists) {
        return NextResponse.json({ error: "SKU already exists" }, { status: 400 });
      }
    }

    await updateProduct(params.id, {
      name: name || existingProduct.name,
      sku: sku || existingProduct.sku,
      costPrice: costPrice !== undefined ? parseFloat(costPrice) : existingProduct.costPrice,
      salePrice: salePrice !== undefined ? parseFloat(salePrice) : existingProduct.salePrice,
      stock: stock !== undefined ? parseInt(stock) : existingProduct.stock,
      sizes: sizes !== undefined ? sizes : existingProduct.sizes,
    });

    const updatedProduct = await getProduct(params.id);
    const owner = await getOwner(existingProduct.ownerId);
    return NextResponse.json({ ...updatedProduct, owner });
  } catch (error) {
    console.error("Error updating product:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const existingProduct = await getProduct(params.id);

    if (!existingProduct) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    await deleteProduct(params.id);

    return NextResponse.json({ message: "Product deleted" });
  } catch (error) {
    console.error("Error deleting product:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
