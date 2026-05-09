import { NextRequest, NextResponse } from "next/server";
import type { PaymentMethod } from "@/lib/db-types";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { CheckoutService } from "@/domains/checkout/checkout-service";
import { FirestoreCheckoutRepository } from "@/domains/checkout/firestore-checkout-repository";
import { HttpError } from "@/lib/api/http-errors";
import { getProduct } from "@/lib/db";

export const dynamic = "force-dynamic";

interface CartItem {
  productId: string;
  size: string;
  quantity: number;
}

interface CheckoutBody {
  items: CartItem[];
  payments?: PaymentMethod[];
  discount?: number;
  clientId?: string;
  payLater?: boolean;
  idempotencyKey?: string;
}

async function buildDemoOrder(body: CheckoutBody, userId: string) {
  const items = Array.isArray(body.items) ? body.items : [];
  const products = await Promise.all(
    items.map(async (item) => {
      const product = await getProduct(item.productId).catch(() => null);
      const salePrice = Number(product?.salePrice || 0);
      const costPrice = Number(product?.costPrice || 0);
      const quantity = Number(item.quantity || 0);
      return {
        productId: item.productId,
        productName: product?.name || "Produto",
        sku: product?.sku || "",
        size: item.size,
        quantity,
        salePrice,
        costPrice,
        lineTotal: salePrice * quantity,
        lineCost: costPrice * quantity,
      };
    })
  );

  const subtotal = products.reduce((sum, p) => sum + p.lineTotal, 0);
  const discount = Number(body.discount || 0);
  const totalAmount = Math.max(0, subtotal - discount);
  const cogsTotal = products.reduce((sum, p) => sum + p.lineCost, 0);
  const payments = Array.isArray(body.payments) ? body.payments : [];

  const now = new Date();
  const fakeId = `demo-${now.getTime().toString(36)}`;

  return {
    id: fakeId,
    items: products,
    payments,
    subtotal,
    discount,
    totalAmount,
    cogsTotal,
    isPaidLater: Boolean(body.payLater),
    isCancelled: false,
    createdAt: now.toISOString(),
    createdById: userId,
    demo: true,
    message: "Venda simulada: nada foi salvo no banco.",
  };
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = (await authorizedRequest.json()) as CheckoutBody;

      if (!body.idempotencyKey) {
        throw new HttpError(400, "idempotencyKey is required");
      }

      // Demo users: return a fully-shaped synthetic order so the POS can print the receipt,
      // but nothing is persisted to Firestore.
      if (user.isDemo) {
        const fakeOrder = await buildDemoOrder(body, user.uid);
        return NextResponse.json(fakeOrder, { status: 201 });
      }

      const service = new CheckoutService(new FirestoreCheckoutRepository());
      const result = await service.execute({
        userId: user.uid,
        userRole: user.role,
        items: body.items,
        payments: body.payments,
        discount: body.discount,
        clientId: body.clientId,
        payLater: body.payLater,
        idempotencyKey: body.idempotencyKey,
      });

      return NextResponse.json(result.body, { status: result.status });
    },
    { operationName: "Checkout POST", allowDemoWrite: true }
  );
}
