import type {
  CashRegister,
  Client,
  ExchangeItemInput,
  ExchangeRecord,
  FinancialAuditAction,
  FinancialMovementPaymentMethod,
  Order,
  PaymentMethod,
  Product,
  StockPurchaseEntry,
  StoreSettings,
  Supplier,
  UserRecord,
} from "@/lib/db-types";
import {
  applyFiadoPayment as applyFiadoPaymentDomain,
  createClient as createClientDomain,
  deleteClient as deleteClientDomain,
  getClient as getClientDomain,
  getClientPendingOrders as getClientPendingOrdersDomain,
  getClients as getClientsDomain,
  markOrderAsPaid as markOrderAsPaidDomain,
  updateClient as updateClientDomain,
  updateClientBalance as updateClientBalanceDomain,
} from "@/domains/clients/clients-db";
import {
  createSupplier as createSupplierDomain,
  deleteSupplier as deleteSupplierDomain,
  getSupplier as getSupplierDomain,
  getSuppliers as getSuppliersDomain,
  updateSupplier as updateSupplierDomain,
} from "@/domains/suppliers/suppliers-db";
import { getStoreSettings as getStoreSettingsDomain, updateStoreSettings as updateStoreSettingsDomain } from "@/domains/settings/settings-db";
import { getUser as getUserDomain, getUsers as getUsersDomain } from "@/domains/users/users-db";
import {
  createProduct as createProductDomain,
  createStockPurchaseEntry as createStockPurchaseEntryDomain,
  deleteProduct as deleteProductDomain,
  getProduct as getProductDomain,
  getProductBySku as getProductBySkuDomain,
  getProducts as getProductsDomain,
  updateProduct as updateProductDomain,
} from "@/domains/products/products-db";
import { getOrders as getOrdersDomain, updateOrder as updateOrderDomain } from "@/domains/orders/orders-db";
import {
  closeCashRegister as closeCashRegisterDomain,
  getCashRegisterOrders as getCashRegisterOrdersDomain,
  getOpenCashRegister as getOpenCashRegisterDomain,
  openCashRegister as openCashRegisterDomain,
  updateCashRegisterSales as updateCashRegisterSalesDomain,
} from "@/domains/cash-register/cash-register-db";
import { processCheckout as processCheckoutDomain } from "@/domains/checkout/checkout-db";
import {
  createExchange as createExchangeDomain,
  getExchanges as getExchangesDomain,
} from "@/domains/exchanges/exchanges-db";
import {
  assertFinancialMonthOpen as assertFinancialMonthOpenDomain,
  createFinancialAuditLog as createFinancialAuditLogDomain,
  isFinancialMonthClosed as isFinancialMonthClosedDomain,
} from "@/domains/financial/financial-db";

export type {
  ProductSize,
  Product,
  StockPurchaseEntry,
  FinancialMovementType,
  FinancialMovementDirection,
  FinancialMovementPaymentMethod,
  FinancialMovementRelatedEntity,
  FinancialMovement,
  FinancialAuditAction,
  OrderItem,
  PaymentMethod,
  FiadoPayment,
  Order,
  ExchangeItemInput,
  ExchangeItem,
  ExchangeRecord,
  UserRecord,
  Client,
  Supplier,
  CashRegister,
  ProductDiscount,
  DiscountSettings,
  StoreSettings,
} from "@/lib/db-types";

export async function createFinancialAuditLog(input: {
  action: FinancialAuditAction;
  actorId: string;
  actorRole: string;
  occurredAt?: Date;
  competencyMonth?: string;
  relatedEntity?: { kind: string; id: string };
  payload?: Record<string, unknown>;
}): Promise<void> {
  return createFinancialAuditLogDomain(input);
}

export async function isFinancialMonthClosed(month: string): Promise<boolean> {
  return isFinancialMonthClosedDomain(month);
}

export async function assertFinancialMonthOpen(date: Date): Promise<void> {
  return assertFinancialMonthOpenDomain(date);
}

// Products
export async function getProducts(): Promise<Product[]> {
  return getProductsDomain();
}

export async function getProduct(id: string): Promise<Product | null> {
  return getProductDomain(id);
}

export async function getProductBySku(sku: string): Promise<Product | null> {
  return getProductBySkuDomain(sku);
}

export async function createProduct(data: Omit<Product, "id" | "createdAt" | "updatedAt">): Promise<Product> {
  return createProductDomain(data);
}

export async function updateProduct(
  id: string,
  data: Partial<Omit<Product, "id" | "createdAt" | "updatedAt">>
): Promise<void> {
  return updateProductDomain(id, data);
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
  return createStockPurchaseEntryDomain(input);
}

export async function deleteProduct(id: string): Promise<void> {
  return deleteProductDomain(id);
}

// Orders
export async function getOrders(
  startDate?: Date,
  endDate?: Date
): Promise<Order[]> {
  return getOrdersDomain(startDate, endDate);
}

export async function updateOrder(input: {
  orderId: string;
  discount: number;
  payments: Array<{ method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"; amount: number }>;
  actorId: string;
  actorRole: string;
}): Promise<Order> {
  return updateOrderDomain(input);
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
  isPaidLater: boolean = false,
  createdById: string = "system",
  createdByRole: string = "ADMIN"
): Promise<Order> {
  return processCheckoutDomain(
    items,
    payments,
    discount,
    clientId,
    clientName,
    isPaidLater,
    createdById,
    createdByRole
  );
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
  return createExchangeDomain(input);
}

export async function getExchanges(
  limitCount: number = 100,
  startDate?: Date,
  endDate?: Date
): Promise<ExchangeRecord[]> {
  return getExchangesDomain(limitCount, startDate, endDate);
}

// Users
export async function getUsers(): Promise<UserRecord[]> {
  return getUsersDomain();
}

export async function getUser(id: string): Promise<UserRecord | null> {
  return getUserDomain(id);
}

// Cash Register
export async function getOpenCashRegister(userId: string): Promise<CashRegister | null> {
  return getOpenCashRegisterDomain(userId);
}

export async function openCashRegister(userId: string, userName: string, openingBalance: number): Promise<CashRegister> {
  return openCashRegisterDomain(userId, userName, openingBalance);
}

export async function closeCashRegister(registerId: string, closingBalance: number): Promise<CashRegister> {
  return closeCashRegisterDomain(registerId, closingBalance);
}

export async function updateCashRegisterSales(registerId: string, payments: PaymentMethod[], saleTotal: number): Promise<void> {
  return updateCashRegisterSalesDomain(registerId, payments, saleTotal);
}

export async function getCashRegisterOrders(registerId: string): Promise<Order[]> {
  return getCashRegisterOrdersDomain(registerId);
}

// Clients
export async function getClients(): Promise<Client[]> {
  return getClientsDomain();
}

export async function getClient(id: string): Promise<Client | null> {
  return getClientDomain(id);
}

export async function createClient(data: Omit<Client, "id" | "createdAt" | "updatedAt" | "balance">): Promise<Client> {
  return createClientDomain(data);
}

export async function updateClient(
  id: string,
  data: Partial<Omit<Client, "id" | "createdAt" | "updatedAt">>
): Promise<void> {
  return updateClientDomain(id, data);
}

export async function updateClientBalance(id: string, amount: number): Promise<void> {
  return updateClientBalanceDomain(id, amount);
}

export async function deleteClient(id: string): Promise<void> {
  return deleteClientDomain(id);
}

// Suppliers
export async function getSuppliers(): Promise<Supplier[]> {
  return getSuppliersDomain();
}

export async function getSupplier(id: string): Promise<Supplier | null> {
  return getSupplierDomain(id);
}

export async function createSupplier(
  data: Omit<Supplier, "id" | "createdAt" | "updatedAt">
): Promise<Supplier> {
  return createSupplierDomain(data);
}

export async function updateSupplier(
  id: string,
  data: Partial<Omit<Supplier, "id" | "createdAt" | "updatedAt">>
): Promise<void> {
  return updateSupplierDomain(id, data);
}

export async function deleteSupplier(id: string): Promise<void> {
  return deleteSupplierDomain(id);
}

export async function getClientPendingOrders(clientId: string): Promise<Order[]> {
  return getClientPendingOrdersDomain(clientId);
}

export async function markOrderAsPaid(orderId: string): Promise<void> {
  return markOrderAsPaidDomain(orderId);
}

export async function applyFiadoPayment(
  clientId: string,
  orderId: string,
  amount: number,
  method: PaymentMethod["method"],
  receivedByUserId?: string
): Promise<void> {
  return applyFiadoPaymentDomain(clientId, orderId, amount, method, receivedByUserId);
}

export async function getStoreSettings(): Promise<StoreSettings> {
  return getStoreSettingsDomain();
}

export async function updateStoreSettings(settings: Partial<Omit<StoreSettings, 'id' | 'updatedAt'>>): Promise<StoreSettings> {
  return updateStoreSettingsDomain(settings);
}
