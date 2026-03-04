import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { convertTimestamp } from "@/domains/shared/firestore-serializers";
import type {
  ExchangeItem,
  ExchangeItemInput,
  ExchangeRecord,
  FinancialMovementPaymentMethod,
  Product,
} from "@/lib/db-types";

function toCompetencyMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export async function createExchange(input: {
  documentNumber?: string;
  customerName?: string;
  notes?: string;
  paymentMethod?: FinancialMovementPaymentMethod;
  discountAmount?: number;
  items: ExchangeItemInput[];
  cashRegisterId?: string;
  createdById: string;
  createdByRole: string;
  createdByName: string;
}): Promise<ExchangeRecord> {
  if (input.createdByRole !== "ADMIN" && input.createdByRole !== "CASHIER") {
    throw new Error("Role not allowed to create exchange");
  }

  const providedDocumentNumber = (input.documentNumber || "").trim();
  const autoDocumentNumber = `AJUSTE-${Date.now()}`;
  const documentNumber = providedDocumentNumber || autoDocumentNumber;
  const requestedDiscountAmount = Number(input.discountAmount || 0);

  if (!Number.isFinite(requestedDiscountAmount) || requestedDiscountAmount < 0) {
    throw new Error("Desconto inválido na troca");
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("Adicione ao menos um item na troca");
  }

  const now = new Date();
  const nowTs = Timestamp.fromDate(now);
  const competencyMonth = toCompetencyMonth(now);
  const exchangeRef = adminDb.collection("exchanges").doc();
  const registerRef = input.cashRegisterId ? adminDb.collection("cashRegisters").doc(input.cashRegisterId) : null;

  const result = await adminDb.runTransaction(async (tx) => {
    const closureSnap = await tx.get(adminDb.collection("financialClosures").doc(competencyMonth));
    if (closureSnap.exists) {
      throw new Error(`Financial month ${competencyMonth} is closed`);
    }

    const normalizedItems: ExchangeItem[] = [];
    let totalInValue = 0;
    let totalOutValue = 0;

    const productIds = Array.from(new Set(input.items.map((item) => item.productId)));
    const productRefs = productIds.map((productId) => adminDb.collection("products").doc(productId));
    const productSnapshots = await Promise.all(productRefs.map((productRef) => tx.get(productRef)));

    const registerSnap = registerRef ? await tx.get(registerRef) : null;
    if (registerRef && (!registerSnap || !registerSnap.exists)) {
      throw new Error("Caixa informado não foi encontrado");
    }

    const registerStatus = registerSnap?.data()?.status;
    if (registerRef && registerStatus !== "OPEN") {
      throw new Error("O caixa precisa estar aberto para registrar diferença de troca");
    }

    const productsById = new Map<string, Product>();
    for (const productSnap of productSnapshots) {
      if (!productSnap.exists) {
        throw new Error("Produto não encontrado na troca");
      }
      const product = { id: productSnap.id, ...convertTimestamp<Omit<Product, "id">>(productSnap.data()!) };
      productsById.set(product.id, product);
    }

    const mutableProducts = new Map<string, Product>();
    for (const [productId, product] of Array.from(productsById.entries())) {
      mutableProducts.set(productId, {
        ...product,
        sizes: Array.isArray(product.sizes) ? product.sizes.map((s) => ({ ...s })) : [],
      });
    }

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

    for (const [productId, product] of Array.from(mutableProducts.entries())) {
      const productRef = adminDb.collection("products").doc(productId);
      const hasSizes = Array.isArray(product.sizes) && product.sizes.length > 0;
      tx.update(productRef, {
        stock: Number(product.stock || 0),
        ...(hasSizes ? { sizes: product.sizes } : {}),
        updatedAt: Timestamp.fromDate(now),
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

    tx.set(exchangeRef, {
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
      createdAt: nowTs,
    });

    if (registerRef && cashInAmount > 0) {
      const registerUpdates: Record<string, FirebaseFirestore.FieldValue> = {
        totalExchangeDifferenceIn: FieldValue.increment(cashInAmount),
        exchangeDifferenceCount: FieldValue.increment(1),
      };

      if (paymentMethod === "cash") registerUpdates.totalCash = FieldValue.increment(cashInAmount);
      if (paymentMethod === "pix") registerUpdates.totalPix = FieldValue.increment(cashInAmount);
      if (paymentMethod === "credit") registerUpdates.totalCredit = FieldValue.increment(cashInAmount);
      if (paymentMethod === "debit") registerUpdates.totalDebit = FieldValue.increment(cashInAmount);

      tx.update(registerRef, registerUpdates);
    }

    if (cashInAmount > 0 && paymentMethod) {
      const movementRef = adminDb.collection("financialMovements").doc();
      tx.set(movementRef, {
        type: "EXCHANGE_DIFFERENCE",
        direction: "IN",
        amount: cashInAmount,
        paymentMethod,
        relatedEntity: { kind: "exchange", id: exchangeRef.id },
        occurredAt: nowTs,
        competencyMonth,
        createdBy: input.createdById,
      });
    }

    return {
      id: exchangeRef.id,
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
    } as ExchangeRecord;
  });

  return result;
}

export async function getExchanges(
  limitCount: number = 100,
  startDate?: Date,
  endDate?: Date
): Promise<ExchangeRecord[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limitCount)));
  let query: FirebaseFirestore.Query = adminDb.collection("exchanges").orderBy("createdAt", "desc");

  if (startDate && endDate) {
    query = adminDb
      .collection("exchanges")
      .where("createdAt", ">=", Timestamp.fromDate(startDate))
      .where("createdAt", "<=", Timestamp.fromDate(endDate))
      .orderBy("createdAt", "desc");
  }

  const snapshot = await query.limit(safeLimit).get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamp<Omit<ExchangeRecord, "id">>(doc.data()),
  }));
}
