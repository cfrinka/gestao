import { NextRequest, NextResponse } from "next/server";
import { getProduct, getProductBySku, updateProduct, deleteProduct, createStockPurchaseEntry } from "@/lib/db";
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

    return NextResponse.json(product);
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
    const { name, sku, costPrice, salePrice, stock, sizes, plusSized } = body;

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

    const nextCostPrice = costPrice !== undefined ? parseFloat(costPrice) : existingProduct.costPrice;
    const nextStock = stock !== undefined ? parseInt(stock) : existingProduct.stock;

    await updateProduct(params.id, {
      name: name || existingProduct.name,
      sku: sku || existingProduct.sku,
      plusSized: plusSized === undefined ? existingProduct.plusSized === true : plusSized === true,
      costPrice: nextCostPrice,
      salePrice: salePrice !== undefined ? parseFloat(salePrice) : existingProduct.salePrice,
      stock: nextStock,
      sizes: sizes !== undefined ? sizes : existingProduct.sizes,
    });

    const stockIncrease = Math.max(0, (nextStock || 0) - (existingProduct.stock || 0));
    if (stockIncrease > 0) {
      await createStockPurchaseEntry({
        productId: existingProduct.id,
        productName: name || existingProduct.name,
        sku: sku || existingProduct.sku,
        quantity: stockIncrease,
        unitCost: nextCostPrice,
        source: "STOCK_REPLENISHMENT",
        createdById: user.uid,
        createdByName: user.email || user.uid,
      });
    }

    const updatedProduct = await getProduct(params.id);
    return NextResponse.json(updatedProduct);
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
