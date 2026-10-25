import { HttpError, IDEMPOTENCY_CONFLICT_MESSAGE, IDEMPOTENCY_IN_PROGRESS_MESSAGE, IDEMPOTENCY_KEY_REQUIRED_MESSAGE } from "@/lib/api/http-errors";
import type { ProductsRepository } from "@/domains/products/repository";
import type { CreateProductCommand, UpdateProductCommand } from "@/domains/products/types";
import type { Product, ProductImageSource, ProductSizeType } from "@/lib/db-types";
import { parseStockEdit, requestedStockDelta } from "@/domains/products/stock-edit";

function toPublicErrorMessage(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (error instanceof Error) return error.message;
  return "Internal server error";
}

function parseSizeType(value: unknown): ProductSizeType {
  return value === "numeric" ? "numeric" : "letter";
}

export class ProductsService {
  constructor(private readonly repository: ProductsRepository) {}

  async list(): Promise<Product[]> {
    return this.repository.getAll();
  }

  async get(id: string): Promise<Product | null> {
    return this.repository.getById(id);
  }

  async create(command: CreateProductCommand): Promise<Product> {
    const name = String(command.name || "").trim();
    const sku = String(command.sku || "").trim();

    if (!name || !sku || command.costPrice === undefined || command.salePrice === undefined) {
      throw new HttpError(400, "Preencha nome, código, custo e preço de venda");
    }

    const existingProduct = await this.repository.getBySku(sku);
    if (existingProduct) {
      throw new HttpError(400, "Já existe um produto com este código (SKU)");
    }

    const costPrice = parseFloat(String(command.costPrice));
    const stock = parseInt(String(command.stock)) || 0;
    const image = command.image ? String(command.image) : undefined;

    // Validated before any write: a product must never be created and then have the
    // request fail on a missing idempotency key, leaving an orphaned stock purchase gap.
    const safeIdempotencyKey = String(command.idempotencyKey || "").trim();
    if (stock > 0 && !safeIdempotencyKey) {
      throw new HttpError(400, IDEMPOTENCY_KEY_REQUIRED_MESSAGE);
    }

    const product = await this.repository.createProduct({
      name,
      sku,
      plusSized: command.plusSized === true,
      sizeType: parseSizeType(command.sizeType),
      category: command.category ? (command.category as Product["category"]) : undefined,
      costPrice,
      salePrice: parseFloat(String(command.salePrice)),
      stock,
      sizes: Array.isArray(command.sizes) ? (command.sizes as Product["sizes"]) : [],
      image,
      imageSource: (command.imageSource as ProductImageSource) || (image ? "random" : "none"),
    });

    if (stock > 0) {
      await this.reserveAndCreateStockPurchase({
        idempotencyKey: safeIdempotencyKey,
        ownerId: product.sku,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: stock,
        unitCost: costPrice,
        source: "PRODUCT_CREATE",
        createdById: command.createdById,
        createdByName: command.createdByName,
      });
    }

    return product;
  }

  async update(id: string, command: UpdateProductCommand): Promise<Product> {
    const existing = await this.repository.getById(id);
    if (!existing) {
      throw new HttpError(404, "Produto não encontrado");
    }

    const nextSku = command.sku ? String(command.sku).trim() : existing.sku;
    if (nextSku !== existing.sku) {
      const skuOwner = await this.repository.getBySku(nextSku);
      if (skuOwner) {
        throw new HttpError(400, "Já existe um produto com este código (SKU)");
      }
    }

    const nextCostPrice = command.costPrice !== undefined ? parseFloat(String(command.costPrice)) : existing.costPrice;
    const nextStock = command.stock !== undefined ? parseInt(String(command.stock)) : existing.stock;
    const nextName = command.name ? String(command.name) : existing.name;

    // A form that says what stock it loaded gets its change applied as a difference over the
    // current stock (see stock-edit.ts); the purchase entry is the pieces it added. Without
    // that information (an older open tab) the form's numbers replace the stock as before.
    const stockEdit = parseStockEdit(command);
    const requestedDelta = stockEdit ? requestedStockDelta(stockEdit) : 0;
    const stockIncrease = stockEdit
      ? Math.max(0, requestedDelta)
      : Math.max(0, (nextStock || 0) - (existing.stock || 0));

    // Validated before any write, for the same reason as in create(): the product must
    // never be updated and then have the request fail on a missing idempotency key,
    // leaving stock changed with no matching purchase entry.
    const safeIdempotencyKey = String(command.idempotencyKey || "").trim();
    if (stockIncrease > 0 && !safeIdempotencyKey) {
      throw new HttpError(400, IDEMPOTENCY_KEY_REQUIRED_MESSAGE);
    }

    const updated = await this.repository.updateProduct(id, {
      name: nextName,
      sku: nextSku,
      plusSized: command.plusSized === undefined ? existing.plusSized === true : command.plusSized === true,
      sizeType: command.sizeType === undefined ? parseSizeType(existing.sizeType) : parseSizeType(command.sizeType),
      category:
        command.category !== undefined
          ? ((command.category as Product["category"]) || undefined)
          : existing.category,
      costPrice: nextCostPrice,
      salePrice: command.salePrice !== undefined ? parseFloat(String(command.salePrice)) : existing.salePrice,
      stock: nextStock,
      sizes: command.sizes !== undefined ? (command.sizes as Product["sizes"]) : existing.sizes,
      image: command.image !== undefined ? (command.image as string) : existing.image,
      imageSource: command.imageSource !== undefined ? (command.imageSource as ProductImageSource) : existing.imageSource,
    }, stockEdit
      ? {
          edit: stockEdit,
          actorId: command.createdById,
          actorName: command.createdByName,
          recordCorrection: requestedDelta <= 0,
        }
      : undefined);

    if (stockIncrease > 0) {
      await this.reserveAndCreateStockPurchase({
        idempotencyKey: safeIdempotencyKey,
        ownerId: nextSku,
        productId: id,
        productName: nextName,
        sku: nextSku,
        quantity: stockIncrease,
        unitCost: nextCostPrice,
        source: "STOCK_REPLENISHMENT",
        createdById: command.createdById,
        createdByName: command.createdByName,
      });
    }

    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.repository.getById(id);
    if (!existing) {
      throw new HttpError(404, "Produto não encontrado");
    }
    await this.repository.deleteProduct(id);
  }

  private async reserveAndCreateStockPurchase(input: {
    idempotencyKey: string;
    ownerId: string;
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitCost: number;
    source: "PRODUCT_CREATE" | "STOCK_REPLENISHMENT";
    createdById: string;
    createdByName: string;
  }): Promise<void> {
    const requestHash = JSON.stringify({
      productId: input.productId,
      quantity: input.quantity,
      unitCost: input.unitCost,
      source: input.source,
    });

    const reservation = await this.repository.reserveIdempotency({
      ownerId: input.ownerId,
      idempotencyKey: input.idempotencyKey,
      requestHash,
    });

    if (reservation.type === "conflict") {
      throw new HttpError(409, IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    if (reservation.type === "completed") {
      return;
    }
    if (reservation.type === "in_progress") {
      throw new HttpError(409, IDEMPOTENCY_IN_PROGRESS_MESSAGE);
    }

    try {
      await this.repository.createStockPurchaseEntry({
        productId: input.productId,
        productName: input.productName,
        sku: input.sku,
        quantity: input.quantity,
        unitCost: input.unitCost,
        source: input.source,
        createdById: input.createdById,
        createdByName: input.createdByName,
      });

      await this.repository.markIdempotencyCompleted({
        ownerId: input.ownerId,
        idempotencyKey: input.idempotencyKey,
        response: null,
      });
    } catch (error) {
      await this.repository.markIdempotencyFailed({
        ownerId: input.ownerId,
        idempotencyKey: input.idempotencyKey,
        errorMessage: toPublicErrorMessage(error),
      });
      throw error;
    }
  }
}
