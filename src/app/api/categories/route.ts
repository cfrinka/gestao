import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { getProductCategories } from "@/domains/products/product-categories-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async () => {
      const categories = await getProductCategories();
      return NextResponse.json({ categories });
    },
    { operationName: "Categories GET" }
  );
}
