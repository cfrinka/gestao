import type { Product } from "@/lib/db-types";

export type { IdempotencyReservation } from "@/domains/shared/idempotency";

export interface CreateProductCommand {
  name: unknown;
  sku: unknown;
  costPrice: unknown;
  salePrice: unknown;
  stock: unknown;
  sizes: unknown;
  plusSized: unknown;
  sizeType: unknown;
  category: unknown;
  image: unknown;
  imageSource: unknown;
  idempotencyKey: unknown;
  createdById: string;
  createdByName: string;
}

export interface UpdateProductCommand {
  name: unknown;
  sku: unknown;
  costPrice: unknown;
  salePrice: unknown;
  stock: unknown;
  sizes: unknown;
  /** Stock the form loaded; when present the save applies only the difference. */
  baseStock?: unknown;
  baseSizes?: unknown;
  plusSized: unknown;
  sizeType: unknown;
  category: unknown;
  image: unknown;
  imageSource: unknown;
  idempotencyKey: unknown;
  createdById: string;
  createdByName: string;
}

export type ProductCreateInput = Omit<Product, "id" | "createdAt" | "updatedAt">;
export type ProductUpdateInput = Partial<ProductCreateInput>;

export interface ProductStockEditOptions {
  edit: import("@/domains/products/stock-edit").StockEdit;
  actorId: string;
  actorName: string;
  /** Log the change as a stock adjustment (a correction rather than a replenishment). */
  recordCorrection: boolean;
}
