import type { Product, StockPurchaseEntry } from "@/lib/db-types";
import type { IdempotencyReservation, ProductCreateInput, ProductUpdateInput } from "@/domains/products/types";

export interface ProductsRepository {
  getAll(): Promise<Product[]>;
  getById(id: string): Promise<Product | null>;
  getBySku(sku: string): Promise<Product | null>;
  createProduct(data: ProductCreateInput): Promise<Product>;
  updateProduct(id: string, data: ProductUpdateInput): Promise<Product>;
  deleteProduct(id: string): Promise<void>;

  createStockPurchaseEntry(input: {
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitCost: number;
    source: "PRODUCT_CREATE" | "STOCK_REPLENISHMENT";
    createdById: string;
    createdByName: string;
  }): Promise<StockPurchaseEntry>;

  reserveIdempotency(input: { ownerId: string; idempotencyKey: string; requestHash: string }): Promise<IdempotencyReservation>;
  markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }): Promise<void>;
  markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }): Promise<void>;
}
