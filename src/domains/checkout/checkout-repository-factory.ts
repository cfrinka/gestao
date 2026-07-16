import { getDemoSessionId } from "@/lib/demo/demo-context";
import { getDemoDataset } from "@/lib/demo/demo-store";
import { FirestoreCheckoutRepository } from "@/domains/checkout/firestore-checkout-repository";
import { InMemoryCheckoutRepository } from "@/domains/checkout/in-memory-checkout-repository";
import type { CheckoutRepository } from "@/domains/checkout/repository";

export function getCheckoutRepository(): CheckoutRepository {
  const sessionId = getDemoSessionId();
  const dataset = sessionId ? getDemoDataset(sessionId) : null;
  if (dataset) {
    return new InMemoryCheckoutRepository(
      dataset.products,
      dataset.productSkuIndex,
      dataset.orders,
      dataset.cashRegisters,
      dataset.clients,
      dataset.idempotency.checkout,
      dataset.discountAuthorizations
    );
  }
  return new FirestoreCheckoutRepository();
}
