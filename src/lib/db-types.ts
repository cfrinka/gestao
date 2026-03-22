import type { Timestamp } from "firebase-admin/firestore";

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
  image?: string;
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

export type FinancialMovementType =
  | "SALE_REVENUE"
  | "COGS"
  | "STOCK_PURCHASE"
  | "OPERATING_EXPENSE"
  | "FIADO_PAYMENT"
  | "EXCHANGE_DIFFERENCE"
  | "REFUND"
  | "ADJUSTMENT";

export type FinancialMovementDirection = "IN" | "OUT";

export type FinancialMovementPaymentMethod = "cash" | "pix" | "credit" | "debit";

export type FinancialMovementRelatedEntity =
  | { kind: "order"; id: string }
  | { kind: "bill"; id: string }
  | { kind: "exchange"; id: string }
  | { kind: "stockPurchase"; id: string };

export type FinancialMovement = {
  id: string;
  type: FinancialMovementType;
  direction: FinancialMovementDirection;
  amount: number;
  paymentMethod?: FinancialMovementPaymentMethod;
  relatedEntity: FinancialMovementRelatedEntity;
  occurredAt: Timestamp;
  competencyMonth: string;
  createdBy: string;
  metadata?: Record<string, unknown>;
};

export type FinancialAuditAction = "FINANCIAL_CLOSE" | "MANUAL_ADJUSTMENT" | "REFUND" | "ORDER_CANCELLATION";

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName?: string;
  ownerId?: string;
  size: string;
  quantity: number;
  unitCostAtSale?: number;
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
  cogsTotal?: number;
  payments: PaymentMethod[];
  clientId?: string;
  clientName?: string;
  isPaidLater?: boolean;
  amountPaid?: number;
  remainingAmount?: number;
  paymentHistory?: FiadoPayment[];
  paidAt?: Date;
  isCancelled?: boolean;
  cancelledAt?: Date;
  cancelledBy?: string;
  cancellationReason?: string;
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
  paymentMethod?: FinancialMovementPaymentMethod;
  items: ExchangeItem[];
  totalInValue: number;
  totalOutValue: number;
  discountAmount: number;
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
  balance: number;
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

export interface ProductDiscount {
  productId: string;
  discountPercent: number;
}

export interface DiscountSettings {
  pixDiscountEnabled: boolean;
  pixDiscountPercent: number;
  fixedDiscountEnabled: boolean;
  fixedDiscountPercent: number;
  progressiveDiscountEnabled: boolean;
  progressiveDiscount1Item: number;
  progressiveDiscount2Items: number;
  progressiveDiscount3PlusItems: number;
  productDiscountsEnabled: boolean;
  productDiscounts: ProductDiscount[];
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
