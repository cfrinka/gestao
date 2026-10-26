import { findCompletedCheckout, getFiadoStanding, processCheckout } from "@/domains/checkout/checkout-db";
import { consumeDiscountAuthorization } from "@/lib/discount-authorization";
import type {
  CheckoutIdempotency,
  CheckoutOrder,
  CheckoutRepository,
  CheckoutResult,
  FiadoStanding,
  ProcessCheckoutInput,
} from "@/domains/checkout/repository";

export class FirestoreCheckoutRepository implements CheckoutRepository {
  async processCheckout(input: ProcessCheckoutInput): Promise<CheckoutResult> {
    return processCheckout(input);
  }

  async findCompletedCheckout(idempotency: CheckoutIdempotency): Promise<CheckoutOrder | null> {
    return findCompletedCheckout(idempotency);
  }

  async consumeDiscountAuthorization(userId: string): Promise<boolean> {
    return consumeDiscountAuthorization(userId);
  }

  async getFiadoStanding(clientId: string): Promise<FiadoStanding | null> {
    return getFiadoStanding(clientId);
  }

  async consumeFiadoAuthorization(userId: string): Promise<boolean> {
    return consumeDiscountAuthorization(userId, "fiado");
  }
}
