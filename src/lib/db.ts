import { adminDb } from "./firebase-admin";
import { Timestamp, FieldValue } from "firebase-admin/firestore";

export interface ProductSize {
  size: string;
  stock: number;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  ownerId?: string;
  plusSized?: boolean;
  costPrice: number;
  salePrice: number;
  stock: number;
  sizes: ProductSize[];
  createdAt: Date;
  updatedAt: Date;
}

export interface StockPurchaseEntry {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  source: "PRODUCT_CREATE" | "STOCK_REPLENISHMENT";
  createdById: string;
  createdByName: string;
  createdAt: Date;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  ownerId?: string;
  size: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  totalCost: number;
  totalRevenue: number;
  profit: number;
}

export interface PaymentMethod {
  method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX";
  amount: number;
}

export interface FiadoPayment {
  id: string;
  amount: number;
  method: PaymentMethod["method"];
  createdAt: Date;
}

export interface Order {
  id: string;
  subtotal: number;
  discount: number;
  totalAmount: number;
  payments: PaymentMethod[];
  clientId?: string;
  clientName?: string;
  isPaidLater?: boolean;
  amountPaid?: number;
  remainingAmount?: number;
  paymentHistory?: FiadoPayment[];
  paidAt?: Date;
  createdAt: Date;
  items?: OrderItem[];
}

export interface ExchangeItemInput {
  productId: string;
  size?: string;
  quantity: number;
  direction: "IN" | "OUT";
}

export interface ExchangeItem {
  productId: string;
  productName: string;
  sku: string;
  size: string;
  quantity: number;
  direction: "IN" | "OUT";
  unitPrice: number;
  totalValue: number;
}

export interface ExchangeRecord {
  id: string;
  documentNumber: string;
  customerName?: string;
  notes?: string;
  items: ExchangeItem[];
  totalInValue: number;
  totalOutValue: number;
  difference: number;
  cashInAmount?: number;
  createdById: string;
  createdByName: string;
  createdAt: Date;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "CASHIER";
  ownerId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Client {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  balance: number; // Positive = client owes money, Negative = store owes client
  createdAt: Date;
  updatedAt: Date;
}

export interface Supplier {
  id: string;
  name: string;
  instagram?: string;
  whatsapp?: string;
  website?: string;
  observations?: string;
  acceptedPaymentMethods: ("DINHEIRO" | "DEBITO" | "CREDITO" | "PIX" | "FIADO")[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CashRegister {
  id: string;
  userId: string;
  userName: string;
  openedAt: Date;
  closedAt: Date | null;
  openingBalance: number;
  closingBalance: number | null;
  status: "OPEN" | "CLOSED";
  totalSales: number;
  totalCash: number;
  totalDebit: number;
  totalCredit: number;
  totalPix: number;
  salesCount: number;
  totalExchangeDifferenceIn: number;
  exchangeDifferenceCount: number;
}

function convertTimestamp(data: FirebaseFirestore.DocumentData): FirebaseFirestore.DocumentData {
  const result = { ...data };
  for (const key in result) {
    if (result[key] instanceof Timestamp) {
      result[key] = result[key].toDate();
    }
  }
  return result;
}

// Products
export async function getProducts(): Promise<Product[]> {
  const snapshot = await adminDb.collection("products").orderBy("name").get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    plusSized: doc.data()?.plusSized === true,
    ...convertTimestamp(doc.data()),
  })) as Product[];
}

export async function getProduct(id: string): Promise<Product | null> {
  const doc = await adminDb.collection("products").doc(id).get();
  if (!doc.exists) return null;
  return {
    id: doc.id,
    plusSized: doc.data()?.plusSized === true,
    ...convertTimestamp(doc.data()!),
  } as Product;
}

export async function getProductBySku(sku: string): Promise<Product | null> {
  const snapshot = await adminDb.collection("products").where("sku", "==", sku).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return {
    id: doc.id,
    plusSized: doc.data()?.plusSized === true,
    ...convertTimestamp(doc.data()),
  } as Product;
}

export async function createProduct(data: Omit<Product, "id" | "createdAt" | "updatedAt">): Promise<Product> {
  const now = new Date();
  const docRef = await adminDb.collection("products").add({
    ...data,
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  });
  return { id: docRef.id, ...data, createdAt: now, updatedAt: now };
}

export async function updateProduct(
  id: string,
  data: Partial<Omit<Product, "id" | "createdAt" | "updatedAt">>
): Promise<void> {
  await adminDb.collection("products").doc(id).update({
    ...data,
    updatedAt: Timestamp.fromDate(new Date()),
  });
}

export async function createStockPurchaseEntry(input: {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitCost: number;
  source: "PRODUCT_CREATE" | "STOCK_REPLENISHMENT";
  createdById: string;
  createdByName: string;
}): Promise<StockPurchaseEntry> {
  const now = new Date();
  const quantity = Math.max(0, Math.floor(Number(input.quantity)));
  const unitCost = Number(input.unitCost || 0);
  const totalCost = quantity * unitCost;

  const docRef = await adminDb.collection("stockPurchases").add({
    productId: input.productId,
    productName: input.productName,
    sku: input.sku,
    quantity,
    unitCost,
    totalCost,
    source: input.source,
    createdById: input.createdById,
    createdByName: input.createdByName,
    createdAt: Timestamp.fromDate(now),
  });

  return {
    id: docRef.id,
    productId: input.productId,
    productName: input.productName,
    sku: input.sku,
    quantity,
    unitCost,
    totalCost,
    source: input.source,
    createdById: input.createdById,
    createdByName: input.createdByName,
    createdAt: now,
  };
}

export async function deleteProduct(id: string): Promise<void> {
  await adminDb.collection("products").doc(id).delete();
}

// Orders
export async function getOrders(
  startDate?: Date,
  endDate?: Date
): Promise<Order[]> {
  let query: FirebaseFirestore.Query = adminDb.collection("orders").orderBy("createdAt", "desc");

  if (startDate && endDate) {
    query = adminDb.collection("orders")
      .where("createdAt", ">=", Timestamp.fromDate(startDate))
      .where("createdAt", "<=", Timestamp.fromDate(endDate))
      .orderBy("createdAt", "desc");
  }

  const ordersSnapshot = await query.get();
  const orders: Order[] = [];

  for (const orderDoc of ordersSnapshot.docs) {
    const orderData = convertTimestamp(orderDoc.data());
    
    const itemsSnapshot = await adminDb.collection("orderItems")
      .where("orderId", "==", orderDoc.id)
      .get();
    
    const items = itemsSnapshot.docs.map((itemDoc) => ({
      id: itemDoc.id,
      ...itemDoc.data(),
    })) as OrderItem[];

    orders.push({
      id: orderDoc.id,
      ...orderData,
      items,
    } as Order);
  }

  return orders;
}

export async function getOrderWithDetails(id: string): Promise<Order | null> {
  const orderDoc = await adminDb.collection("orders").doc(id).get();
  if (!orderDoc.exists) return null;

  const itemsSnapshot = await adminDb.collection("orderItems")
    .where("orderId", "==", id)
    .get();

  const items = itemsSnapshot.docs.map((itemDoc) => ({
    id: itemDoc.id,
    ...itemDoc.data(),
  })) as OrderItem[];

  return {
    id: orderDoc.id,
    ...convertTimestamp(orderDoc.data()!),
    items,
  } as Order;
}

// Checkout
interface CheckoutItem {
  productId: string;
  size: string;
  quantity: number;
}

export async function processCheckout(
  items: CheckoutItem[], 
  payments: PaymentMethod[] = [], 
  discount: number = 0,
  clientId?: string,
  clientName?: string,
  isPaidLater: boolean = false
): Promise<Order> {
  const batch = adminDb.batch();

  const products: (Product & { requestedQty: number; requestedSize: string })[] = [];
  for (const item of items) {
    const product = await getProduct(item.productId);
    if (!product) {
      throw new Error(`Product ${item.productId} not found`);
    }
    if (product.sizes && product.sizes.length > 0) {
      const sizeStock = product.sizes.find(s => s.size === item.size);
      if (!sizeStock || sizeStock.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name} size ${item.size}. Available: ${sizeStock?.stock || 0}`);
      }
    } else if (product.stock < item.quantity) {
      throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stock}`);
    }
    products.push({ ...product, requestedQty: item.quantity, requestedSize: item.size });
  }

  let subtotal = 0;
  const orderItems: Omit<OrderItem, "id">[] = [];

  for (const product of products) {
    const quantity = product.requestedQty;
    const unitCost = product.costPrice;
    const unitPrice = product.salePrice;
    const totalCost = unitCost * quantity;
    const totalRevenue = unitPrice * quantity;
    const profit = totalRevenue - totalCost;

    subtotal += totalRevenue;

    orderItems.push({
      orderId: "",
      productId: product.id,
      ...(product.ownerId ? { ownerId: product.ownerId } : {}),
      size: product.requestedSize,
      quantity,
      unitCost,
      unitPrice,
      totalCost,
      totalRevenue,
      profit,
    });
  }

  const totalAmount = Math.max(0, subtotal - discount);

  const orderRef = adminDb.collection("orders").doc();
  batch.set(orderRef, {
    subtotal,
    discount,
    totalAmount,
    payments,
    ...(clientId && { clientId }),
    ...(clientName && { clientName }),
    ...(isPaidLater && {
      isPaidLater,
      amountPaid: 0,
      remainingAmount: totalAmount,
      paymentHistory: [],
    }),
    createdAt: Timestamp.fromDate(new Date()),
  });

  for (const itemData of orderItems) {
    const itemRef = adminDb.collection("orderItems").doc();
    batch.set(itemRef, { ...itemData, orderId: orderRef.id });
  }

  for (const product of products) {
    const productRef = adminDb.collection("products").doc(product.id);
    
    const updates: Record<string, unknown> = {
      stock: FieldValue.increment(-product.requestedQty),
      updatedAt: Timestamp.fromDate(new Date()),
    };
    
    if (product.sizes && product.sizes.length > 0) {
      const updatedSizes = product.sizes.map(s => 
        s.size === product.requestedSize 
          ? { ...s, stock: s.stock - product.requestedQty }
          : s
      );
      updates.sizes = updatedSizes;
    }
    
    batch.update(productRef, updates);
  }

  await batch.commit();

  return {
    id: orderRef.id,
    subtotal,
    discount,
    totalAmount,
    payments,
    createdAt: new Date(),
    items: orderItems.map((item, index) => ({ ...item, id: `item-${index}`, orderId: orderRef.id })),
  };
}

export async function createExchange(input: {
  documentNumber?: string;
  customerName?: string;
  notes?: string;
  items: ExchangeItemInput[];
  cashRegisterId?: string;
  createdById: string;
  createdByName: string;
}): Promise<ExchangeRecord> {
  const providedDocumentNumber = (input.documentNumber || "").trim();
  const autoDocumentNumber = `AJUSTE-${Date.now()}`;
  const documentNumber = providedDocumentNumber || autoDocumentNumber;

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("Adicione ao menos um item na troca");
  }

  const now = new Date();
  const exchangeRef = adminDb.collection("exchanges").doc();
  const registerRef = input.cashRegisterId
    ? adminDb.collection("cashRegisters").doc(input.cashRegisterId)
    : null;

  const result = await adminDb.runTransaction(async (tx) => {
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
      const product = { id: productSnap.id, ...convertTimestamp(productSnap.data()!) } as Product;
      productsById.set(product.id, product);
    }

    const mutableProducts = new Map<string, Product>();
    for (const [productId, product] of Array.from(productsById.entries())) {
      mutableProducts.set(productId, {
        ...product,
        sizes: Array.isArray(product.sizes)
          ? product.sizes.map((s: { size: string; stock: number }) => ({ ...s }))
          : [],
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
          idx === sizeIndex
            ? { ...s, stock: s.stock + (item.direction === "IN" ? quantity : -quantity) }
            : s
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

    const difference = totalOutValue - totalInValue;
    const cashInAmount = Math.max(0, difference);

    tx.set(exchangeRef, {
      documentNumber,
      customerName: (input.customerName || "").trim(),
      notes: (input.notes || "").trim(),
      items: normalizedItems,
      totalInValue,
      totalOutValue,
      difference,
      cashInAmount,
      createdById: input.createdById,
      createdByName: input.createdByName,
      createdAt: Timestamp.fromDate(now),
    });

    if (registerRef && cashInAmount > 0) {
      tx.update(registerRef, {
        totalCash: FieldValue.increment(cashInAmount),
        totalExchangeDifferenceIn: FieldValue.increment(cashInAmount),
        exchangeDifferenceCount: FieldValue.increment(1),
      });
    }

    return {
      id: exchangeRef.id,
      documentNumber,
      customerName: (input.customerName || "").trim(),
      notes: (input.notes || "").trim(),
      items: normalizedItems,
      totalInValue,
      totalOutValue,
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
    ...convertTimestamp(doc.data()),
  })) as ExchangeRecord[];
}

// Users
export async function getUsers(): Promise<UserRecord[]> {
  const snapshot = await adminDb.collection("users").orderBy("name").get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamp(doc.data()),
  })) as UserRecord[];
}

export async function getUser(id: string): Promise<UserRecord | null> {
  const doc = await adminDb.collection("users").doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...convertTimestamp(doc.data()!) } as UserRecord;
}

// Cash Register
export async function getOpenCashRegister(userId: string): Promise<CashRegister | null> {
  const snapshot = await adminDb.collection("cashRegisters")
    .where("userId", "==", userId)
    .where("status", "==", "OPEN")
    .limit(1)
    .get();
  
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...convertTimestamp(doc.data()) } as CashRegister;
}

export async function openCashRegister(userId: string, userName: string, openingBalance: number): Promise<CashRegister> {
  const now = new Date();
  const docRef = await adminDb.collection("cashRegisters").add({
    userId,
    userName,
    openedAt: Timestamp.fromDate(now),
    closedAt: null,
    openingBalance,
    closingBalance: null,
    status: "OPEN",
    totalSales: 0,
    totalCash: 0,
    totalDebit: 0,
    totalCredit: 0,
    totalPix: 0,
    salesCount: 0,
    totalExchangeDifferenceIn: 0,
    exchangeDifferenceCount: 0,
  });
  
  return {
    id: docRef.id,
    userId,
    userName,
    openedAt: now,
    closedAt: null,
    openingBalance,
    closingBalance: null,
    status: "OPEN",
    totalSales: 0,
    totalCash: 0,
    totalDebit: 0,
    totalCredit: 0,
    totalPix: 0,
    salesCount: 0,
    totalExchangeDifferenceIn: 0,
    exchangeDifferenceCount: 0,
  };
}

export async function closeCashRegister(registerId: string, closingBalance: number): Promise<CashRegister> {
  const now = new Date();
  await adminDb.collection("cashRegisters").doc(registerId).update({
    closedAt: Timestamp.fromDate(now),
    closingBalance,
    status: "CLOSED",
  });
  
  const doc = await adminDb.collection("cashRegisters").doc(registerId).get();
  return { id: doc.id, ...convertTimestamp(doc.data()!) } as CashRegister;
}

export async function updateCashRegisterSales(registerId: string, payments: PaymentMethod[], saleTotal: number): Promise<void> {
  const cashAmount = payments.find(p => p.method === "DINHEIRO")?.amount || 0;
  const debitAmount = payments.find(p => p.method === "DEBITO")?.amount || 0;
  const creditAmount = payments.find(p => p.method === "CREDITO")?.amount || 0;
  const pixAmount = payments.find(p => p.method === "PIX")?.amount || 0;
  
  await adminDb.collection("cashRegisters").doc(registerId).update({
    totalSales: FieldValue.increment(saleTotal),
    totalCash: FieldValue.increment(cashAmount),
    totalDebit: FieldValue.increment(debitAmount),
    totalCredit: FieldValue.increment(creditAmount),
    totalPix: FieldValue.increment(pixAmount),
    salesCount: FieldValue.increment(1),
  });
}

export async function getCashRegisterOrders(registerId: string): Promise<Order[]> {
  const register = await adminDb.collection("cashRegisters").doc(registerId).get();
  if (!register.exists) return [];
  
  const registerData = register.data()!;
  const openedAt = registerData.openedAt;
  const closedAt = registerData.closedAt || Timestamp.now();
  
  const snapshot = await adminDb.collection("orders")
    .where("createdAt", ">=", openedAt)
    .where("createdAt", "<=", closedAt)
    .orderBy("createdAt", "desc")
    .get();
  
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamp(doc.data()),
  })) as Order[];
}

// Store Settings
export interface DiscountSettings {
  pixDiscountEnabled: boolean;
  pixDiscountPercent: number;
  fixedDiscountEnabled: boolean;
  fixedDiscountPercent: number;
  progressiveDiscountEnabled: boolean;
  progressiveDiscount1Item: number;
  progressiveDiscount2Items: number;
  progressiveDiscount3PlusItems: number;
}

export interface StoreSettings {
  id: string;
  storeName: string;
  address: string;
  phone: string;
  cnpj: string;
  footerMessage: string;
  exchangeDays: number;
  discounts: DiscountSettings;
  updatedAt: Date;
}

const DEFAULT_DISCOUNT_SETTINGS: DiscountSettings = {
  pixDiscountEnabled: false,
  pixDiscountPercent: 5,
  fixedDiscountEnabled: false,
  fixedDiscountPercent: 0,
  progressiveDiscountEnabled: false,
  progressiveDiscount1Item: 0,
  progressiveDiscount2Items: 0,
  progressiveDiscount3PlusItems: 0,
};

const DEFAULT_SETTINGS: Omit<StoreSettings, 'id' | 'updatedAt'> = {
  storeName: 'Gestão Loja',
  address: '',
  phone: '',
  cnpj: '',
  footerMessage: 'Obrigado pela preferência!\nVolte sempre!',
  exchangeDays: 10,
  discounts: DEFAULT_DISCOUNT_SETTINGS,
};

// Clients
export async function getClients(): Promise<Client[]> {
  const snapshot = await adminDb.collection("clients").orderBy("name").get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamp(doc.data()),
  })) as Client[];
}

export async function getClient(id: string): Promise<Client | null> {
  const doc = await adminDb.collection("clients").doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...convertTimestamp(doc.data()!) } as Client;
}

export async function createClient(data: Omit<Client, "id" | "createdAt" | "updatedAt" | "balance">): Promise<Client> {
  const now = new Date();
  const docRef = await adminDb.collection("clients").add({
    ...data,
    balance: 0,
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  });
  return { id: docRef.id, ...data, balance: 0, createdAt: now, updatedAt: now };
}

export async function updateClient(
  id: string,
  data: Partial<Omit<Client, "id" | "createdAt" | "updatedAt">>
): Promise<void> {
  await adminDb.collection("clients").doc(id).update({
    ...data,
    updatedAt: Timestamp.fromDate(new Date()),
  });
}

export async function updateClientBalance(id: string, amount: number): Promise<void> {
  await adminDb.collection("clients").doc(id).update({
    balance: FieldValue.increment(amount),
    updatedAt: Timestamp.fromDate(new Date()),
  });
}

export async function deleteClient(id: string): Promise<void> {
  await adminDb.collection("clients").doc(id).delete();
}

// Suppliers
export async function getSuppliers(): Promise<Supplier[]> {
  const snapshot = await adminDb.collection("suppliers").orderBy("name").get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamp(doc.data()),
  })) as Supplier[];
}

export async function getSupplier(id: string): Promise<Supplier | null> {
  const doc = await adminDb.collection("suppliers").doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...convertTimestamp(doc.data()!) } as Supplier;
}

export async function createSupplier(
  data: Omit<Supplier, "id" | "createdAt" | "updatedAt">
): Promise<Supplier> {
  const now = new Date();
  const sanitizedData = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined)
  ) as Omit<Supplier, "id" | "createdAt" | "updatedAt">;
  const docRef = await adminDb.collection("suppliers").add({
    ...sanitizedData,
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  });
  return { id: docRef.id, ...sanitizedData, createdAt: now, updatedAt: now };
}

export async function updateSupplier(
  id: string,
  data: Partial<Omit<Supplier, "id" | "createdAt" | "updatedAt">>
): Promise<void> {
  const sanitizedData = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined)
  ) as Partial<Omit<Supplier, "id" | "createdAt" | "updatedAt">>;
  await adminDb.collection("suppliers").doc(id).update({
    ...sanitizedData,
    updatedAt: Timestamp.fromDate(new Date()),
  });
}

export async function deleteSupplier(id: string): Promise<void> {
  await adminDb.collection("suppliers").doc(id).delete();
}

export async function getClientPendingOrders(clientId: string): Promise<Order[]> {
  const snapshot = await adminDb.collection("orders")
    .where("clientId", "==", clientId)
    .where("isPaidLater", "==", true)
    .get();
  
  const orders = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamp(doc.data()),
  })) as Order[];
  
  // Prefer remainingAmount if present (supports partial payments). Fallback to paidAt for legacy orders.
  return orders.filter(order => {
    if (typeof order.remainingAmount === "number") return order.remainingAmount > 0;
    return !order.paidAt;
  });
}

export async function markOrderAsPaid(orderId: string): Promise<void> {
  await adminDb.collection("orders").doc(orderId).update({
    paidAt: Timestamp.fromDate(new Date()),
  });
}

export async function applyFiadoPayment(
  clientId: string,
  orderId: string,
  amount: number,
  method: PaymentMethod["method"]
): Promise<void> {
  if (!amount || amount <= 0) {
    throw new Error("Payment amount must be greater than zero");
  }

  const orderRef = adminDb.collection("orders").doc(orderId);
  const clientRef = adminDb.collection("clients").doc(clientId);

  await adminDb.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw new Error("Order not found");
    }

    const order = convertTimestamp(orderSnap.data()!) as Order;
    if (!order.isPaidLater) {
      throw new Error("Order is not a FIADO order");
    }
    if (order.clientId !== clientId) {
      throw new Error("Order does not belong to this client");
    }

    const currentPaid = typeof order.amountPaid === "number" ? order.amountPaid : (order.paidAt ? order.totalAmount : 0);
    const currentRemaining = typeof order.remainingAmount === "number" ? order.remainingAmount : (order.paidAt ? 0 : order.totalAmount);

    if (currentRemaining <= 0) {
      throw new Error("Order is already fully paid");
    }

    const appliedAmount = Math.min(amount, currentRemaining);
    const nextPaid = currentPaid + appliedAmount;
    const nextRemaining = Math.max(0, currentRemaining - appliedAmount);

    const payment: Omit<FiadoPayment, "createdAt"> & { createdAt: FirebaseFirestore.Timestamp } = {
      id: `pay_${Date.now()}`,
      amount: appliedAmount,
      method,
      createdAt: Timestamp.fromDate(new Date()),
    };

    tx.update(orderRef, {
      amountPaid: nextPaid,
      remainingAmount: nextRemaining,
      paymentHistory: FieldValue.arrayUnion(payment),
      ...(nextRemaining === 0 ? { paidAt: Timestamp.fromDate(new Date()) } : {}),
    });

    tx.update(clientRef, {
      balance: FieldValue.increment(-appliedAmount),
      updatedAt: Timestamp.fromDate(new Date()),
    });
  });
}

export async function getStoreSettings(): Promise<StoreSettings> {
  const doc = await adminDb.collection("settings").doc("store").get();
  
  if (!doc.exists) {
    return {
      id: 'store',
      ...DEFAULT_SETTINGS,
      updatedAt: new Date(),
    };
  }
  
  return {
    id: doc.id,
    ...DEFAULT_SETTINGS,
    ...convertTimestamp(doc.data()!),
  } as StoreSettings;
}

export async function updateStoreSettings(settings: Partial<Omit<StoreSettings, 'id' | 'updatedAt'>>): Promise<StoreSettings> {
  const now = new Date();
  await adminDb.collection("settings").doc("store").set({
    ...settings,
    updatedAt: Timestamp.fromDate(now),
  }, { merge: true });
  
  return getStoreSettings();
}
