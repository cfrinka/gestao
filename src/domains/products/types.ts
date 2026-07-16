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
  plusSized: unknown;
  category: unknown;
  image: unknown;
  imageSource: unknown;
  idempotencyKey: unknown;
  createdById: string;
  createdByName: string;
}

export type ProductCreateInput = Omit<Product, "id" | "createdAt" | "updatedAt">;
export type ProductUpdateInput = Partial<ProductCreateInput>;
