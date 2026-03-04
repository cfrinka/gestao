import { NextRequest, NextResponse } from "next/server";
import type { PaymentMethod } from "@/lib/db-types";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { CheckoutService } from "@/domains/checkout/checkout-service";
import { FirestoreCheckoutRepository } from "@/domains/checkout/firestore-checkout-repository";
import { HttpError } from "@/lib/api/http-errors";

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

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = (await authorizedRequest.json()) as CheckoutBody;
      const service = new CheckoutService(new FirestoreCheckoutRepository());

      if (!body.idempotencyKey) {
        throw new HttpError(400, "idempotencyKey is required");
      }

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
    { operationName: "Checkout POST" }
  );
}
