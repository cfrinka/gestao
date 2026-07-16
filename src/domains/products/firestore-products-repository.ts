import {
  getProducts,
  getProduct,
  getProductBySku,
  createProduct,
  updateProduct,
  deleteProduct,
  createStockPurchaseEntry,
} from "@/domains/products/products-db";
import { markIdempotencyCompleted, markIdempotencyFailed, reserveIdempotency } from "@/domains/shared/idempotency";
import type { ProductsRepository } from "@/domains/products/repository";
import type { IdempotencyReservation, ProductCreateInput, ProductUpdateInput } from "@/domains/products/types";
import type { Product, StockPurchaseEntry } from "@/lib/db-types";

const SCOPE = "products-stock-purchase";

export class FirestoreProductsRepository implements ProductsRepository {
  async getAll(): Promise<Product[]> {
    return getProducts();
  }

  async getById(id: string): Promise<Product | null> {
    return getProduct(id);
  }

  async getBySku(sku: string): Promise<Product | null> {
    return getProductBySku(sku);
  }

  async createProduct(data: ProductCreateInput): Promise<Product> {
    return createProduct(data);
  }

  async updateProduct(id: string, data: ProductUpdateInput): Promise<Product> {
    return updateProduct(id, data);
  }

  async deleteProduct(id: string): Promise<void> {
    return deleteProduct(id);
  }

  async createStockPurchaseEntry(input: {
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitCost: number;
    source: "PRODUCT_CREATE" | "STOCK_REPLENISHMENT";
    createdById: string;
    createdByName: string;
  }): Promise<StockPurchaseEntry> {
    return createStockPurchaseEntry(input);
  }

  async reserveIdempotency(input: {
    ownerId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<IdempotencyReservation> {
    return reserveIdempotency(SCOPE, input.ownerId, input.idempotencyKey, input.requestHash);
  }

  async markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }): Promise<void> {
    await markIdempotencyCompleted(SCOPE, input.ownerId, input.idempotencyKey, input.response);
  }

  async markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }): Promise<void> {
    await markIdempotencyFailed(SCOPE, input.ownerId, input.idempotencyKey, input.errorMessage);
  }
}
