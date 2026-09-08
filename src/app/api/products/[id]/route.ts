import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { ProductsService } from "@/domains/products/products-service";
import { getProductsRepository } from "@/domains/products/products-repository-factory";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  return withAuthorizedRoute(
    request,
    async () => {
      const service = new ProductsService(getProductsRepository());
      const product = await service.get(id);

      if (!product) {
        return NextResponse.json({ error: "Product not found" }, { status: 404 });
      }

      return NextResponse.json(product);
    },
    { operationName: "Product GET" }
  );
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = await authorizedRequest.json();
      const service = new ProductsService(getProductsRepository());

      const updatedProduct = await service.update(id, {
        ...body,
        createdById: user.uid,
        createdByName: user.email || user.uid,
      });

      return NextResponse.json(updatedProduct);
    },
    { roles: ["ADMIN"], operationName: "Product PUT" }
  );
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  return withAuthorizedRoute(
    request,
    async () => {
      const service = new ProductsService(getProductsRepository());
      await service.remove(id);
      return NextResponse.json({ message: "Product deleted" });
    },
    { roles: ["ADMIN"], operationName: "Product DELETE" }
  );
}
