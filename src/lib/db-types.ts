import type { Timestamp } from "firebase-admin/firestore";

export interface ProductSize {
  size: string;
  stock: number;
}

export type ProductImageSource = "uploaded" | "random" | "none";

// "letter" = letter sizes (TU, P, M...), "numeric" = numbered sizes (36, 38, 40...).
export type ProductSizeType = "letter" | "numeric";

export interface Product {
  id: string;
  name: string;
  sku: string;
  ownerId?: string;
  plusSized?: boolean;
  sizeType?: ProductSizeType;
  // One of the names in settings/productCategories (see product-categories-db.ts).
  category?: string;
  costPrice: number;
  salePrice: number;
  stock: number;
  sizes: ProductSize[];
  image?: string;
  imageSource?: ProductImageSource;
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
  receivedByUserId?: string;
  receivedByUserName?: string;
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
  createdById?: string;
  createdByName?: string;
  /** Register that took this sale (set on sales made after the register link was introduced). */
  cashRegisterId?: string;
  /** Cash handed back to the customer; `payments` already holds only what the store kept. */
  change?: number;
  /** The customer's mobile on a regular sale, when the cashier took it: "(11) 98765-4321". */
  customerPhone?: string;
  /** The store's automatic discounts and the cashier's manual one; together they make `discount`. */
  promoDiscount?: number;
  manualDiscount?: number;
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
  /** Money in the customer's favour: "cash" when it was handed back from the register. */
  refundMode?: "cash" | "none";
  refundAmount?: number;
  addedToCashRegisterSales?: boolean;
  addedToCashRegisterSalesAt?: Date;
  createdById: string;
  createdByName: string;
  createdAt: Date;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "CASHIER";
  isActive?: boolean;
  deactivatedAt?: Date | null;
  deactivatedBy?: string | null;
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
  totalCashSupply: number;
  totalCashWithdrawal: number;
  salesCount: number;
  totalExchangeDifferenceIn: number;
  /** Cash handed back to customers on exchanges (already taken out of totalCash). */
  totalExchangeRefundOut?: number;
  exchangeDifferenceCount: number;
  /** Set at closing: the cash the drawer should have held, counted minus expected, and why. */
  expectedCash?: number;
  cashDifference?: number;
  differenceNote?: string;
}

export interface ProductDiscount {
  productId: string;
  discountPercent: number;
  /** First and last store day ("YYYY-MM-DD") the discount counts; without them it always does. */
  startsAt?: string;
  endsAt?: string;
  /** "clearance" when it was set from the Liquidação screen. */
  source?: "clearance";
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
  progressiveDiscount4PlusItems: number;
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
  /** Sellers' commission on their sales, in percent (3 = 3%). */
  commissionPercent: number;
  /** Most a client may owe after a fiado sale, in reais; 0 = no limit. */
  fiadoLimit: number;
  /** New fiado is refused once a client's oldest open purchase is older than this; 0 = never. */
  fiadoMaxDays: number;
  /** Closing a register with a cash difference above this (in reais) asks for the reason. */
  registerDifferenceLimit: number;
  discounts: DiscountSettings;
  updatedAt: Date;
}
