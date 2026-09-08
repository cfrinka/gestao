import { describe, expect, it } from "vitest";
import { InMemoryCheckoutRepository } from "./in-memory-checkout-repository";
import { HttpError } from "@/lib/api/http-errors";
import type { CashRegister, Client, Order, Product } from "@/lib/db-types";

function makeRepo(productOverrides: Partial<Product> = {}) {
  const product: Product = {
    id: "p1",
    name: "Camiseta",
    sku: "SKU1",
    costPrice: 20,
    salePrice: 100,
    stock: 10,
    sizes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...productOverrides,
  };
  const products = new Map<string, Product>([["p1", product]]);
  const orders = new Map<string, Order>();
  const cashRegisters = new Map<string, CashRegister>();
  const clients = new Map<string, Client>();
  const repo = new InMemoryCheckoutRepository(
    products,
    new Map(),
    orders,
    cashRegisters,
    clients,
    new Map()
  );
  return { repo, products, orders };
}

const baseInput = {
  items: [{ productId: "p1", size: "", quantity: 1 }],
  discount: 0,
  payLater: false,
  createdById: "u1",
  createdByRole: "CASHIER",
};

describe("InMemoryCheckoutRepository.processCheckout payment reconciliation", () => {
  it("accepts a sale whose payments sum to the order total", async () => {
    const { repo, orders } = makeRepo();
    const order = await repo.processCheckout({
      ...baseInput,
      payments: [{ method: "DINHEIRO", amount: 100 }],
    });
    expect(order.totalAmount).toBe(100);
    expect(orders.size).toBe(1);
  });

  it("accepts a split payment that sums to the total", async () => {
    const { repo } = makeRepo();
    const order = await repo.processCheckout({
      ...baseInput,
      payments: [
        { method: "DEBITO", amount: 40 },
        { method: "DINHEIRO", amount: 60 },
      ],
    });
    expect(order.totalAmount).toBe(100);
  });

  it("rejects a sale whose payments fall short of the total", async () => {
    const { repo, orders } = makeRepo();
    await expect(
      repo.processCheckout({ ...baseInput, payments: [{ method: "DINHEIRO", amount: 10 }] })
    ).rejects.toBeInstanceOf(HttpError);
    expect(orders.size).toBe(0);
  });

  it("rejects a sale whose payments exceed the total (change recorded as cash taken)", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.processCheckout({ ...baseInput, payments: [{ method: "DINHEIRO", amount: 100 }, { method: "PIX", amount: 100 }] })
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("tolerates sub-cent rounding drift between client and server discount math", async () => {
    const { repo } = makeRepo();
    const order = await repo.processCheckout({
      ...baseInput,
      discount: 33.336,
      payments: [{ method: "DINHEIRO", amount: 66.66 }],
    });
    expect(order.totalAmount).toBeCloseTo(66.664, 2);
  });

  it("does not reconcile payments for a fiado (pay-later) sale", async () => {
    const { repo } = makeRepo();
    const order = await repo.processCheckout({
      ...baseInput,
      payLater: true,
      clientId: "c1",
      payments: [],
    });
    expect(order.isPaidLater).toBe(true);
    expect(order.remainingAmount).toBe(100);
  });
});
