import { randomUUID } from "crypto";
import type {
  Product,
  Order,
  Client,
  CashRegister,
  ExchangeRecord,
  StockPurchaseEntry,
  UserRecord,
  StoreSettings,
  Supplier,
} from "@/lib/db-types";
import type { BillRecord } from "@/domains/bills/types";
import type { StockAdjustmentRecord } from "@/domains/stock-adjustments/types";
import type { DebtCorrectionRecord } from "@/domains/clients/in-memory-clients-repository";

export type IdempotencyEntry = {
  requestHash: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  response?: unknown;
};

/**
 * All state for one demo visitor's session. Repositories are constructed fresh per request
 * (see each domain's *-repository-factory.ts) but always point at these same Maps, so writes
 * in one request are visible to the next request in the same session.
 */
export interface DemoDataset {
  products: Map<string, Product>;
  productSkuIndex: Map<string, string>;
  orders: Map<string, Order>;
  clients: Map<string, Client>;
  cashRegisters: Map<string, CashRegister>;
  bills: Map<string, BillRecord>;
  exchanges: Map<string, ExchangeRecord>;
  stockPurchases: Map<string, StockPurchaseEntry>;
  stockAdjustments: Map<string, StockAdjustmentRecord>;
  users: Map<string, UserRecord>;
  settings: StoreSettings;
  suppliers: Map<string, Supplier>;
  debtCorrections: Map<string, DebtCorrectionRecord>;
  closedFinancialMonths: Set<string>;
  discountAuthorizations: Set<string>;

  idempotency: {
    products: Map<string, IdempotencyEntry>;
    checkout: Map<string, IdempotencyEntry>;
    cashRegister: Map<string, IdempotencyEntry>;
    bills: Map<string, IdempotencyEntry>;
    exchanges: Map<string, IdempotencyEntry>;
    stockAdjustments: Map<string, IdempotencyEntry>;
    users: Map<string, IdempotencyEntry>;
  };
}

interface DemoSessionEntry {
  sessionId: string;
  role: "ADMIN" | "CASHIER";
  data: DemoDataset;
  lastAccessedAt: number;
}

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

const globalForDemoStore = globalThis as unknown as {
  __demoSessions?: Map<string, DemoSessionEntry>;
  __demoSweepTimer?: ReturnType<typeof setInterval>;
};

function getRegistry(): Map<string, DemoSessionEntry> {
  if (!globalForDemoStore.__demoSessions) {
    globalForDemoStore.__demoSessions = new Map();
  }
  if (!globalForDemoStore.__demoSweepTimer) {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [sessionId, entry] of globalForDemoStore.__demoSessions!) {
        if (now - entry.lastAccessedAt > SESSION_TTL_MS) {
          globalForDemoStore.__demoSessions!.delete(sessionId);
        }
      }
    }, SWEEP_INTERVAL_MS);
    timer.unref?.();
    globalForDemoStore.__demoSweepTimer = timer;
  }
  return globalForDemoStore.__demoSessions;
}

export function createEmptyDemoDataset(): DemoDataset {
  return {
    products: new Map(),
    productSkuIndex: new Map(),
    orders: new Map(),
    clients: new Map(),
    cashRegisters: new Map(),
    bills: new Map(),
    exchanges: new Map(),
    stockPurchases: new Map(),
    stockAdjustments: new Map(),
    users: new Map(),
    suppliers: new Map(),
    debtCorrections: new Map(),
    closedFinancialMonths: new Set(),
    discountAuthorizations: new Set(),
    settings: {
      id: "store",
      storeName: "Loja Demo — Portfólio",
      address: "",
      phone: "",
      cnpj: "",
      footerMessage: "Obrigado pela preferência!\nVolte sempre!",
      exchangeDays: 10,
      discounts: {
        pixDiscountEnabled: false,
        pixDiscountPercent: 5,
        fixedDiscountEnabled: false,
        fixedDiscountPercent: 0,
        progressiveDiscountEnabled: false,
        progressiveDiscount1Item: 0,
        progressiveDiscount2Items: 0,
        progressiveDiscount3PlusItems: 40,
        progressiveDiscount4PlusItems: 60,
        productDiscountsEnabled: false,
        productDiscounts: [],
      },
      updatedAt: new Date(),
    },
    idempotency: {
      products: new Map(),
      checkout: new Map(),
      cashRegister: new Map(),
      bills: new Map(),
      exchanges: new Map(),
      stockAdjustments: new Map(),
      users: new Map(),
    },
  };
}

export function createDemoSession(role: "ADMIN" | "CASHIER", data: DemoDataset): string {
  const sessionId = randomUUID();
  getRegistry().set(sessionId, { sessionId, role, data, lastAccessedAt: Date.now() });
  return sessionId;
}

export function getDemoSession(sessionId: string): DemoSessionEntry | null {
  const entry = getRegistry().get(sessionId);
  if (!entry) return null;
  entry.lastAccessedAt = Date.now();
  return entry;
}

export function getDemoDataset(sessionId: string): DemoDataset | null {
  return getDemoSession(sessionId)?.data ?? null;
}

export function deleteDemoSession(sessionId: string): void {
  getRegistry().delete(sessionId);
}
