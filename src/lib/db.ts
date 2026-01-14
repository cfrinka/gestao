import { adminDb } from "./firebase-admin";
import { Timestamp, FieldValue } from "firebase-admin/firestore";

export interface Owner {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductSize {
  size: string;
  stock: number;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  ownerId: string;
  costPrice: number;
  salePrice: number;
  stock: number;
  sizes: ProductSize[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  ownerId: string;
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

export interface Order {
  id: string;
  totalAmount: number;
  payments: PaymentMethod[];
  createdAt: Date;
  items?: OrderItem[];
}

export interface OwnerLedger {
  id: string;
  ownerId: string;
  orderId: string;
  revenue: number;
  cost: number;
  profit: number;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "OWNER" | "CASHIER";
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
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

// Owners
export async function getOwners(): Promise<Owner[]> {
  const snapshot = await adminDb.collection("owners").orderBy("name").get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamp(doc.data()),
  })) as Owner[];
}

export async function getOwner(id: string): Promise<Owner | null> {
  const doc = await adminDb.collection("owners").doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...convertTimestamp(doc.data()!) } as Owner;
}

export async function createOwner(name: string): Promise<Owner> {
  const now = new Date();
  const docRef = await adminDb.collection("owners").add({
    name,
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  });
  return { id: docRef.id, name, createdAt: now, updatedAt: now };
}

// Products
export async function getProducts(ownerId?: string): Promise<Product[]> {
  let query: FirebaseFirestore.Query = adminDb.collection("products").orderBy("name");
  if (ownerId) {
    query = adminDb.collection("products").where("ownerId", "==", ownerId).orderBy("name");
  }
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamp(doc.data()),
  })) as Product[];
}

export async function getProduct(id: string): Promise<Product | null> {
  const doc = await adminDb.collection("products").doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...convertTimestamp(doc.data()!) } as Product;
}

export async function getProductBySku(sku: string): Promise<Product | null> {
  const snapshot = await adminDb.collection("products").where("sku", "==", sku).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...convertTimestamp(doc.data()) } as Product;
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

export async function deleteProduct(id: string): Promise<void> {
  await adminDb.collection("products").doc(id).delete();
}

// Orders
export async function getOrders(
  startDate?: Date,
  endDate?: Date,
  ownerId?: string
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

    if (ownerId && !items.some((item) => item.ownerId === ownerId)) {
      continue;
    }

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

export async function processCheckout(items: CheckoutItem[], payments: PaymentMethod[] = []): Promise<Order> {
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

  let totalAmount = 0;
  const orderItems: Omit<OrderItem, "id">[] = [];

  for (const product of products) {
    const quantity = product.requestedQty;
    const unitCost = product.costPrice;
    const unitPrice = product.salePrice;
    const totalCost = unitCost * quantity;
    const totalRevenue = unitPrice * quantity;
    const profit = totalRevenue - totalCost;

    totalAmount += totalRevenue;

    orderItems.push({
      orderId: "",
      productId: product.id,
      ownerId: product.ownerId,
      size: product.requestedSize,
      quantity,
      unitCost,
      unitPrice,
      totalCost,
      totalRevenue,
      profit,
    });
  }

  const orderRef = adminDb.collection("orders").doc();
  batch.set(orderRef, {
    totalAmount,
    payments,
    createdAt: Timestamp.fromDate(new Date()),
  });

  const ownerLedgerMap = new Map<string, { revenue: number; cost: number; profit: number }>();

  for (const itemData of orderItems) {
    const itemRef = adminDb.collection("orderItems").doc();
    batch.set(itemRef, { ...itemData, orderId: orderRef.id });

    const existing = ownerLedgerMap.get(itemData.ownerId) || { revenue: 0, cost: 0, profit: 0 };
    ownerLedgerMap.set(itemData.ownerId, {
      revenue: existing.revenue + itemData.totalRevenue,
      cost: existing.cost + itemData.totalCost,
      profit: existing.profit + itemData.profit,
    });
  }

  for (const [ownerId, ledgerData] of Array.from(ownerLedgerMap)) {
    const ledgerRef = adminDb.collection("ownerLedgers").doc();
    batch.set(ledgerRef, {
      ownerId,
      orderId: orderRef.id,
      ...ledgerData,
    });
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
    totalAmount,
    payments,
    createdAt: new Date(),
    items: orderItems.map((item, index) => ({ ...item, id: `item-${index}`, orderId: orderRef.id })),
  };
}

// Owner Ledgers
export async function getOwnerLedgers(ownerId?: string, startDate?: Date, endDate?: Date) {
  let query: FirebaseFirestore.Query = adminDb.collection("ownerLedgers");

  if (ownerId) {
    query = query.where("ownerId", "==", ownerId);
  }

  const snapshot = await query.get();
  let ledgers = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as OwnerLedger[];

  if (startDate && endDate) {
    const orderIds = new Set<string>();
    const ordersSnapshot = await adminDb.collection("orders")
      .where("createdAt", ">=", Timestamp.fromDate(startDate))
      .where("createdAt", "<=", Timestamp.fromDate(endDate))
      .get();
    ordersSnapshot.docs.forEach((doc) => orderIds.add(doc.id));
    ledgers = ledgers.filter((l) => orderIds.has(l.orderId));
  }

  return ledgers;
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
