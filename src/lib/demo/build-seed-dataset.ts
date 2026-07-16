import fixturesJson from "@/lib/demo/seed-fixtures.json";
import { createEmptyDemoDataset, type DemoDataset } from "@/lib/demo/demo-store";
import { DEMO_ADMIN_EMAIL, DEMO_ADMIN_UID, DEMO_CASHIER_EMAIL, DEMO_CASHIER_UID, demoNameForRole } from "@/lib/demo/demo-auth";
import { InMemoryProductsRepository } from "@/domains/products/in-memory-products-repository";
import { InMemoryClientsRepository } from "@/domains/clients/in-memory-clients-repository";
import { InMemoryBillsRepository } from "@/domains/bills/in-memory-bills-repository";
import { InMemoryCashRegisterRepository } from "@/domains/cash-register/in-memory-cash-register-repository";
import { InMemoryCheckoutRepository } from "@/domains/checkout/in-memory-checkout-repository";
import type { Client, PaymentMethod, Product, ProductCategory, UserRecord } from "@/lib/db-types";

interface SeedProduct {
  name: string;
  sku: string;
  category: string;
  costPrice: number;
  salePrice: number;
  plusSized?: boolean;
  sizes: { size: string; stock: number }[];
}

interface SeedClient {
  name: string;
  phone: string;
  email: string;
}

interface SeedBill {
  name: string;
  amount: number;
  status: "PENDING" | "PAID";
  dueOffsetDays: number;
  paidOffsetDays?: number;
  paidMethod?: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX";
}

const fixtures = fixturesJson as {
  products: SeedProduct[];
  clients: SeedClient[];
  bills: SeedBill[];
};

const PAYMENT_METHODS: PaymentMethod["method"][] = ["DINHEIRO", "DEBITO", "CREDITO", "PIX"];

function daysAgo(n: number, hour = 12): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d;
}

/** Rings up one small sale (1-2 units of a rotating product) against the given register. */
async function ringUpSale(
  checkoutRepo: InMemoryCheckoutRepository,
  registerId: string,
  product: Product,
  paymentMethod: PaymentMethod["method"],
  cashier: UserRecord,
  options: { payLaterClient?: Client } = {}
): Promise<string> {
  const size = product.sizes[0]?.size ?? "";
  const quantity = 1;
  const payLater = Boolean(options.payLaterClient);

  const order = await checkoutRepo.processCheckout({
    items: [{ productId: product.id, size, quantity }],
    payments: payLater ? [] : [{ method: paymentMethod, amount: product.salePrice * quantity }],
    discount: 0,
    clientId: options.payLaterClient?.id,
    clientName: options.payLaterClient?.name,
    payLater,
    createdById: cashier.id,
    createdByRole: cashier.role,
  });

  if (payLater && options.payLaterClient) {
    await checkoutRepo.updateClientBalance(options.payLaterClient.id, order.totalAmount);
  } else {
    await checkoutRepo.updateCashRegisterSales(registerId, order.payments, order.totalAmount);
  }

  return order.id;
}

function backdateOrders(dataset: DemoDataset, orderIds: string[], baseDate: Date): void {
  orderIds.forEach((id, index) => {
    const order = dataset.orders.get(id);
    if (!order) return;
    const stamped = new Date(baseDate);
    stamped.setMinutes(stamped.getMinutes() + index * 7);
    dataset.orders.set(id, { ...order, createdAt: stamped });
  });
}

/**
 * Builds one visitor's isolated demo dataset: seeds products, clients, bills, and two fixed
 * demo users, then drives real business logic (InMemoryProductsRepository.createProduct,
 * InMemoryCheckoutRepository.processCheckout, InMemoryCashRegisterRepository.openRegister/
 * closeRegister) instead of hand-authoring cross-referenced documents, so order totals, stock,
 * cash-register totals, and client balances all stay internally consistent for free.
 */
export async function buildSeedDataset(): Promise<DemoDataset> {
  const dataset = createEmptyDemoDataset();
  const now = new Date();

  const admin: UserRecord = {
    id: DEMO_ADMIN_UID,
    email: DEMO_ADMIN_EMAIL,
    name: demoNameForRole("ADMIN"),
    role: "ADMIN",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  const cashier: UserRecord = {
    id: DEMO_CASHIER_UID,
    email: DEMO_CASHIER_EMAIL,
    name: demoNameForRole("CASHIER"),
    role: "CASHIER",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  dataset.users.set(admin.id, admin);
  dataset.users.set(cashier.id, cashier);

  // Products (+ an initial stock-purchase entry per product, for the Stock Entries screen)
  const productsRepo = new InMemoryProductsRepository(
    dataset.products,
    dataset.productSkuIndex,
    dataset.idempotency.products,
    dataset.stockPurchases
  );
  const products: Product[] = [];
  for (const p of fixtures.products) {
    const stock = p.sizes.reduce((sum, s) => sum + s.stock, 0);
    const product = await productsRepo.createProduct({
      name: p.name,
      sku: p.sku,
      costPrice: p.costPrice,
      salePrice: p.salePrice,
      stock,
      sizes: p.sizes,
      plusSized: p.plusSized ?? false,
      category: p.category as ProductCategory,
    });
    const entry = await productsRepo.createStockPurchaseEntry({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      quantity: stock,
      unitCost: product.costPrice,
      source: "PRODUCT_CREATE",
      createdById: admin.id,
      createdByName: admin.name,
    });
    dataset.stockPurchases.set(entry.id, { ...entry, createdAt: daysAgo(28, 10) });
    products.push(product);
  }

  // Clients (some end up with a fiado balance once seed sales below run payLater)
  const clientsRepo = new InMemoryClientsRepository(
    dataset.clients,
    dataset.orders,
    dataset.products,
    dataset.cashRegisters,
    dataset.debtCorrections
  );
  const clients: Client[] = [];
  for (const c of fixtures.clients) {
    clients.push(await clientsRepo.createClient({ name: c.name, phone: c.phone, email: c.email }));
  }

  // Bills
  const billsRepo = new InMemoryBillsRepository(dataset.bills, dataset.idempotency.bills);
  for (const b of fixtures.bills) {
    const dueDate = daysAgo(-b.dueOffsetDays);
    const { id } = await billsRepo.createOneTimeBill({ name: b.name, amount: b.amount, dueDate: dueDate.toISOString() });
    if (b.status === "PAID") {
      await billsRepo.markBillPaid({ billId: id, method: b.paidMethod || "PIX", actorId: admin.id });
      const bill = dataset.bills.get(id);
      if (bill) {
        dataset.bills.set(id, { ...bill, dueDate, paidAt: daysAgo(-(b.paidOffsetDays ?? b.dueOffsetDays)) });
      }
    } else {
      const bill = dataset.bills.get(id);
      if (bill) dataset.bills.set(id, { ...bill, dueDate });
    }
  }

  // Cash register cycles: two closed (previous month, this month) + one open today.
  const cashRegisterRepo = new InMemoryCashRegisterRepository(
    dataset.cashRegisters,
    dataset.orders,
    dataset.idempotency.cashRegister
  );
  const checkoutRepo = new InMemoryCheckoutRepository(
    dataset.products,
    dataset.productSkuIndex,
    dataset.orders,
    dataset.cashRegisters,
    dataset.clients,
    dataset.idempotency.checkout,
    dataset.discountAuthorizations
  );

  // Cycle 1: previous month, closed, no fiado.
  const registerA = await cashRegisterRepo.openRegister(cashier.id, cashier.name, 100);
  const ordersA: string[] = [];
  for (let i = 0; i < 3; i++) {
    ordersA.push(
      await ringUpSale(checkoutRepo, registerA.id, products[i % products.length], PAYMENT_METHODS[i % PAYMENT_METHODS.length], cashier)
    );
  }
  backdateOrders(dataset, ordersA, daysAgo(35, 10));
  await cashRegisterRepo.closeRegister(registerA.id, 100);
  const closedA = dataset.cashRegisters.get(registerA.id);
  if (closedA) {
    dataset.cashRegisters.set(registerA.id, { ...closedA, openedAt: daysAgo(35, 9), closedAt: daysAgo(35, 19) });
  }

  // Cycle 2: this month, closed, includes one fiado sale (João Pereira).
  const registerB = await cashRegisterRepo.openRegister(cashier.id, cashier.name, 100);
  const ordersB: string[] = [];
  for (let i = 0; i < 3; i++) {
    ordersB.push(
      await ringUpSale(checkoutRepo, registerB.id, products[(i + 3) % products.length], PAYMENT_METHODS[i % PAYMENT_METHODS.length], cashier)
    );
  }
  ordersB.push(await ringUpSale(checkoutRepo, registerB.id, products[6], "PIX", cashier, { payLaterClient: clients[1] }));
  backdateOrders(dataset, ordersB, daysAgo(5, 10));
  await cashRegisterRepo.closeRegister(registerB.id, 100);
  const closedB = dataset.cashRegisters.get(registerB.id);
  if (closedB) {
    dataset.cashRegisters.set(registerB.id, { ...closedB, openedAt: daysAgo(5, 9), closedAt: daysAgo(5, 19) });
  }

  // Cycle 3: today, left OPEN so /pos and /cash-register have something live to show, includes
  // one fiado sale (Fernanda Costa).
  const registerC = await cashRegisterRepo.openRegister(cashier.id, cashier.name, 150);
  for (let i = 0; i < 2; i++) {
    await ringUpSale(checkoutRepo, registerC.id, products[(i + 1) % products.length], PAYMENT_METHODS[(i + 1) % PAYMENT_METHODS.length], cashier);
  }
  await ringUpSale(checkoutRepo, registerC.id, products[5], "DINHEIRO", cashier, { payLaterClient: clients[2] });

  return dataset;
}
