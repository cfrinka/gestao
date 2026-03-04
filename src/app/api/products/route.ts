import { NextRequest, NextResponse } from "next/server";
import { getProducts, getProductBySku, createProduct, createStockPurchaseEntry } from "@/lib/db";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async () => {
      const products = await getProducts();
      return NextResponse.json(products);
    },
    { operationName: "Products GET" }
  );
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = await authorizedRequest.json();
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

      if ((product.stock || 0) > 0) {
        await createStockPurchaseEntry({
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity: product.stock,
          unitCost: product.costPrice,
          source: "PRODUCT_CREATE",
          createdById: user.uid,
          createdByName: user.email || user.uid,
        });
      }

      return NextResponse.json(product, { status: 201 });
    },
    { roles: ["ADMIN"], operationName: "Products POST" }
  );
}
