import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { ProductsService } from "@/domains/products/products-service";
import { FirestoreProductsRepository } from "@/domains/products/firestore-products-repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async () => {
      const service = new ProductsService(new FirestoreProductsRepository());
      const products = await service.list();
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
      const service = new ProductsService(new FirestoreProductsRepository());

      const product = await service.create({
        ...body,
        createdById: user.uid,
        createdByName: user.email || user.uid,
      });

      return NextResponse.json(product, { status: 201 });
    },
    { roles: ["ADMIN"], operationName: "Products POST" }
  );
}
