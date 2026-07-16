import { randomUUID } from "crypto";
import type { CashRegister, ExchangeItem, ExchangeRecord, Product } from "@/lib/db-types";
import type { ExchangesRepository } from "@/domains/exchanges/repository";
import type { ExchangeItemCommand, ExchangePaymentMethod, IdempotencyReservation } from "@/domains/exchanges/types";

/**
 * Mirrors demo-store.ts's IdempotencyEntry shape structurally. Declared locally (instead of
 * importing demo-store.ts) so this repository stays a pure, Map-driven class with no
 * dependency on session/request wiring.
 */
export interface IdempotencyEntry {
  requestHash: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  response?: unknown;
}

function paymentField(method: ExchangePaymentMethod): "totalCash" | "totalPix" | "totalCredit" | "totalDebit" {
  if (method === "cash") return "totalCash";
  if (method === "pix") return "totalPix";
  if (method === "credit") return "totalCredit";
  return "totalDebit";
}

/**
 * In-memory equivalent of FirestoreExchangesRepository for demo mode. Constructed fresh per
 * request but always points at the same session-scoped Maps, so state persists across
 * requests within a demo session.
 *
 * Exchanges mutate stock on both sides of the swap and can post a value difference to the
 * currently open cash register, so this repository needs constructor access to the shared
 * `products` and `cashRegisters` Maps in addition to its own `exchanges` Map.
 *
 * `discountAuthorizations` stands in for the real app's server-issued, single-use discount
 * override grant (normally persisted outside this domain via @/lib/discount-authorization).
 * DemoDataset has no field for that concept yet, so it's accepted here as a plain Set the
 * caller controls; in the demo factory this can simply be a fresh empty Set per session.
 */
export class InMemoryExchangesRepository implements ExchangesRepository {
  constructor(
    private exchanges: Map<string, ExchangeRecord>,
    private products: Map<string, Product>,
    private cashRegisters: Map<string, CashRegister>,
    private idempotency: Map<string, IdempotencyEntry>,
    private discountAuthorizations: Set<string> = new Set()
  ) {}

  async listExchanges(input: { limit: number; startDate?: Date; endDate?: Date }): Promise<ExchangeRecord[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(input.limit)));
    let records = Array.from(this.exchanges.values());

    if (input.startDate && input.endDate) {
      const start = input.startDate.getTime();
      const end = input.endDate.getTime();
      records = records.filter((r) => {
        const createdAt = r.createdAt instanceof Date ? r.createdAt.getTime() : new Date(r.createdAt).getTime();
        return createdAt >= start && createdAt <= end;
      });
    }

    records = records
      .slice()
      .sort((a, b) => {
        const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
        const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
        return bTime - aTime;
      });

    return records.slice(0, safeLimit);
  }

  async reserveIdempotency(input: {
    ownerId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<IdempotencyReservation> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotency.get(key);
    if (!existing) {
      this.idempotency.set(key, { requestHash: input.requestHash, status: "PROCESSING" });
      return { type: "new" };
    }
    if (existing.requestHash !== input.requestHash) return { type: "conflict" };
    if (existing.status === "COMPLETED") return { type: "completed", response: existing.response };
    if (existing.status === "PROCESSING") return { type: "in_progress" };
    existing.status = "PROCESSING";
    return { type: "new" };
  }

  async markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }): Promise<void> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotency.get(key);
    if (existing) {
      existing.status = "COMPLETED";
      existing.response = input.response;
    }
  }

  async markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }): Promise<void> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotency.get(key);
    if (existing) existing.status = "FAILED";
  }

  async getOpenCashRegisterId(userId: string): Promise<string | undefined> {
    const register = Array.from(this.cashRegisters.values()).find((r) => r.userId === userId && r.status === "OPEN");
    return register?.id;
  }

  async getProductSalePrices(productIds: string[]): Promise<Map<string, number>> {
    const uniqueIds = Array.from(new Set(productIds));
    const prices = new Map<string, number>();
    for (const id of uniqueIds) {
      prices.set(id, Number(this.products.get(id)?.salePrice || 0));
    }
    return prices;
  }

  /** Consumes a server-issued discount-override grant for this user, if one is live. Single-use. */
  async consumeDiscountAuthorization(userId: string): Promise<boolean> {
    if (this.discountAuthorizations.has(userId)) {
      this.discountAuthorizations.delete(userId);
      return true;
    }
    return false;
  }

  async createExchange(input: {
    documentNumber?: string;
    customerName?: string;
    notes?: string;
    paymentMethod?: ExchangePaymentMethod;
    discountAmount?: number;
    items: ExchangeItemCommand[];
    cashRegisterId?: string;
    createdById: string;
    createdByRole: string;
    createdByName: string;
  }): Promise<ExchangeRecord> {
    if (input.createdByRole !== "ADMIN" && input.createdByRole !== "CASHIER") {
      throw new Error("Role not allowed to create exchange");
    }

    const providedDocumentNumber = (input.documentNumber || "").trim();
    const documentNumber = providedDocumentNumber || `AJUSTE-${Date.now()}`;
    const requestedDiscountAmount = Number(input.discountAmount || 0);

    if (!Number.isFinite(requestedDiscountAmount) || requestedDiscountAmount < 0) {
      throw new Error("Desconto inválido na troca");
    }

    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new Error("Adicione ao menos um item na troca");
    }

    const now = new Date();
    const register = input.cashRegisterId ? this.cashRegisters.get(input.cashRegisterId) : undefined;
    if (input.cashRegisterId && !register) {
      throw new Error("Caixa informado não foi encontrado");
    }
    if (register && register.status !== "OPEN") {
      throw new Error("O caixa precisa estar aberto para registrar diferença de troca");
    }

    const productIds = Array.from(new Set(input.items.map((item) => item.productId)));
    const mutableProducts = new Map<string, Product>();
    for (const productId of productIds) {
      const product = this.products.get(productId);
      if (!product) {
        throw new Error("Produto não encontrado na troca");
      }
      mutableProducts.set(productId, { ...product, sizes: product.sizes.map((s) => ({ ...s })) });
    }

    const normalizedItems: ExchangeItem[] = [];
    let totalInValue = 0;
    let totalOutValue = 0;

    for (const item of input.items) {
      const quantity = Math.floor(Number(item.quantity));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Quantidade inválida na troca");
      }
      if (item.direction !== "IN" && item.direction !== "OUT") {
        throw new Error("Direção da troca inválida");
      }

      const product = mutableProducts.get(item.productId);
      if (!product) {
        throw new Error("Produto não encontrado na troca");
      }
      const hasSizes = Array.isArray(product.sizes) && product.sizes.length > 0;
      const size = (item.size || "").trim();

      if (hasSizes && !size) {
        throw new Error(`Selecione o tamanho para ${product.name}`);
      }

      if (hasSizes) {
        const sizeIndex = product.sizes.findIndex((s) => s.size === size);
        if (sizeIndex < 0) {
          throw new Error(`Tamanho ${size} não encontrado para ${product.name}`);
        }

        const currentSizeStock = Number(product.sizes[sizeIndex]?.stock || 0);
        if (item.direction === "OUT" && currentSizeStock < quantity) {
          throw new Error(`Estoque insuficiente de ${product.name} (${size}). Disponível: ${currentSizeStock}`);
        }

        product.sizes = product.sizes.map((s, idx) =>
          idx === sizeIndex ? { ...s, stock: s.stock + (item.direction === "IN" ? quantity : -quantity) } : s
        );
      }

      const currentStock = Number(product.stock || 0);
      if (item.direction === "OUT" && currentStock < quantity) {
        throw new Error(`Estoque insuficiente de ${product.name}. Disponível: ${currentStock}`);
      }

      product.stock = currentStock + (item.direction === "IN" ? quantity : -quantity);

      const unitPrice = Number(product.salePrice || 0);
      const totalValue = unitPrice * quantity;

      normalizedItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        size,
        quantity,
        direction: item.direction,
        unitPrice,
        totalValue,
      });

      if (item.direction === "IN") totalInValue += totalValue;
      if (item.direction === "OUT") totalOutValue += totalValue;
    }

    // Commit the mutated products back to the shared Map, recomputing total stock from sizes
    // (when present) so the two stay consistent, mirroring the Firestore implementation.
    for (const [productId, product] of Array.from(mutableProducts.entries())) {
      const original = this.products.get(productId);
      if (!original) continue;
      const hasSizes = Array.isArray(product.sizes) && product.sizes.length > 0;
      const finalStock = hasSizes ? product.sizes.reduce((sum, s) => sum + Number(s.stock || 0), 0) : Number(product.stock || 0);
      this.products.set(productId, {
        ...original,
        stock: finalStock,
        ...(hasSizes ? { sizes: product.sizes } : {}),
        updatedAt: now,
      });
    }

    const grossDifference = totalOutValue - totalInValue;
    const discountAmount = Math.min(requestedDiscountAmount, Math.max(0, grossDifference));
    const difference = grossDifference - discountAmount;
    const cashInAmount = Math.max(0, difference);
    const paymentMethod = cashInAmount > 0 ? input.paymentMethod : undefined;

    if (cashInAmount > 0 && !paymentMethod) {
      throw new Error("Selecione a forma de pagamento da diferença da troca");
    }

    const id = randomUUID();
    const record: ExchangeRecord = {
      id,
      documentNumber,
      customerName: (input.customerName || "").trim(),
      notes: (input.notes || "").trim(),
      ...(paymentMethod ? { paymentMethod } : {}),
      items: normalizedItems,
      totalInValue,
      totalOutValue,
      discountAmount,
      difference,
      cashInAmount,
      createdById: input.createdById,
      createdByName: input.createdByName,
      createdAt: now,
    };
    this.exchanges.set(id, record);

    if (register && cashInAmount > 0 && paymentMethod) {
      register.totalExchangeDifferenceIn += cashInAmount;
      register.exchangeDifferenceCount += 1;
      register[paymentField(paymentMethod)] += cashInAmount;
    }

    return record;
  }
}
