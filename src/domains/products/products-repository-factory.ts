import { getDemoSessionId } from "@/lib/demo/demo-context";
import { getDemoDataset } from "@/lib/demo/demo-store";
import { FirestoreProductsRepository } from "@/domains/products/firestore-products-repository";
import { InMemoryProductsRepository } from "@/domains/products/in-memory-products-repository";
import type { ProductsRepository } from "@/domains/products/repository";

export function getProductsRepository(): ProductsRepository {
  const sessionId = getDemoSessionId();
  const dataset = sessionId ? getDemoDataset(sessionId) : null;
  if (dataset) {
    return new InMemoryProductsRepository(
      dataset.products,
      dataset.productSkuIndex,
      dataset.idempotency.products,
      dataset.stockPurchases
    );
  }
  return new FirestoreProductsRepository();
}
