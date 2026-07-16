import { describe, expect, it, vi } from "vitest";
import { ClientsService } from "./clients-service";
import { InMemoryClientsRepository, type DebtCorrectionRecord } from "./in-memory-clients-repository";
import type { CashRegister, Client, Order, Product } from "@/lib/db-types";
import { HttpError } from "@/lib/api/http-errors";

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: "client-1",
    name: "Test Client",
    balance: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePendingOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    clientId: "client-1",
    subtotal: 100,
    discount: 0,
    totalAmount: 100,
    payments: [],
    createdAt: new Date(),
    isPaidLater: true,
    remainingAmount: 100,
    items: [
      {
        id: "item-1",
        orderId: "order-1",
        productId: "prod-1",
        size: "",
        quantity: 1,
        unitCost: 5,
        unitPrice: 10,
        totalCost: 5,
        totalRevenue: 10,
        profit: 5,
      },
    ],
    ...overrides,
  };
}

function makeRepo() {
  const clients = new Map<string, Client>([["client-1", makeClient()]]);
  const orders = new Map<string, Order>([["order-1", makePendingOrder()]]);
  const products = new Map<string, Product>();
  const cashRegisters = new Map<string, CashRegister>();
  const debtCorrections = new Map<string, DebtCorrectionRecord>();
  const repo = new InMemoryClientsRepository(clients, orders, products, cashRegisters, debtCorrections);
  return { repo, clients, orders, products, cashRegisters, debtCorrections };
}

describe("ClientsService.list", () => {
  it("delegates to the repository", async () => {
    const { repo } = makeRepo();
    const spy = vi.spyOn(repo, "listClients");
    const service = new ClientsService(repo);
    const result = await service.list();
    expect(result).toHaveLength(1);
    expect(spy).toHaveBeenCalled();
  });
});

describe("ClientsService.get", () => {
  it("rejects a nonexistent client", async () => {
    const { repo } = makeRepo();
    const service = new ClientsService(repo);
    await expect(service.get("missing")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns the client with its pending orders", async () => {
    const { repo } = makeRepo();
    const service = new ClientsService(repo);
    const result = await service.get("client-1");
    expect(result.id).toBe("client-1");
    expect(result.pendingOrders).toHaveLength(1);
  });
});

describe("ClientsService.update", () => {
  it("rejects a nonexistent client", async () => {
    const { repo } = makeRepo();
    const service = new ClientsService(repo);
    await expect(service.update({ clientId: "missing", name: "New Name" })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("updates an existing client", async () => {
    const { repo } = makeRepo();
    const spy = vi.spyOn(repo, "updateClient");
    const service = new ClientsService(repo);
    const updated = await service.update({ clientId: "client-1", name: "Renamed", phone: "123", email: "a@b.com", notes: "note" });
    expect(spy).toHaveBeenCalledWith("client-1", { name: "Renamed", phone: "123", email: "a@b.com", notes: "note" });
    expect(updated.id).toBe("client-1");
    expect(updated.name).toBe("Renamed");
  });

  it("rejects when the client disappears between the update and the re-fetch", async () => {
    const { repo, clients } = makeRepo();
    vi.spyOn(repo, "updateClient").mockImplementationOnce(async () => {
      clients.delete("client-1");
    });
    const service = new ClientsService(repo);
    await expect(service.update({ clientId: "client-1", name: "Renamed" })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("ClientsService.create", () => {
  it("rejects a missing name", async () => {
    const { repo } = makeRepo();
    const service = new ClientsService(repo);
    await expect(service.create({ name: "" })).rejects.toThrow(HttpError);
  });

  it("creates a client with a valid name", async () => {
    const { repo, clients } = makeRepo();
    const spy = vi.spyOn(repo, "createClient");
    const service = new ClientsService(repo);
    const client = await service.create({ name: "New Client" });
    expect(client.id).toBeTruthy();
    expect(clients.get(client.id)?.name).toBe("New Client");
    expect(spy).toHaveBeenCalledWith({ name: "New Client", phone: undefined, email: undefined, notes: undefined });
  });
});

describe("ClientsService.remove", () => {
  it("rejects a nonexistent client", async () => {
    const { repo } = makeRepo();
    const service = new ClientsService(repo);
    await expect(service.remove("missing")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects deleting a client with a pending balance", async () => {
    const { repo } = makeRepo();
    const service = new ClientsService(repo);
    await expect(service.remove("client-1")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("deletes a client with a zero balance", async () => {
    const { repo, clients } = makeRepo();
    clients.set("client-1", makeClient({ balance: 0 }));
    const spy = vi.spyOn(repo, "deleteClient");
    const service = new ClientsService(repo);
    await service.remove("client-1");
    expect(spy).toHaveBeenCalledWith("client-1");
    expect(clients.has("client-1")).toBe(false);
  });
});

describe("ClientsService.correctDebt", () => {
  it("rejects a nonexistent client", async () => {
    const { repo } = makeRepo();
    const service = new ClientsService(repo);
    await expect(
      service.correctDebt({ clientId: "missing", amount: -50, adminPassword: "pw", reason: "test" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects a missing admin password or reason", async () => {
    const { repo } = makeRepo();
    const service = new ClientsService(repo);
    await expect(
      service.correctDebt({ clientId: "client-1", amount: -50, adminPassword: "", reason: "test" })
    ).rejects.toThrow(HttpError);
    await expect(
      service.correctDebt({ clientId: "client-1", amount: -50, adminPassword: "pw", reason: "" })
    ).rejects.toThrow(HttpError);
  });

  it("translates 'Invalid admin password' into a 403", async () => {
    const { repo } = makeRepo();
    vi.spyOn(repo, "correctClientDebt").mockRejectedValueOnce(new Error("Invalid admin password"));
    const service = new ClientsService(repo);

    await expect(
      service.correctDebt({ clientId: "client-1", amount: -50, adminPassword: "wrong", reason: "test" })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects a zero correction amount", async () => {
    const { repo } = makeRepo();
    const service = new ClientsService(repo);
    await expect(
      service.correctDebt({ clientId: "client-1", amount: 0, adminPassword: "pw", reason: "test" })
    ).rejects.toThrow(HttpError);
  });

  it("translates a generic repository error into a 400 with its own message", async () => {
    const { repo } = makeRepo();
    vi.spyOn(repo, "correctClientDebt").mockRejectedValueOnce(new Error("Financial month 2026-06 is closed"));
    const service = new ClientsService(repo);
    await expect(
      service.correctDebt({ clientId: "client-1", amount: -50, adminPassword: "pw", reason: "test" })
    ).rejects.toMatchObject({ statusCode: 400, message: "Financial month 2026-06 is closed" });
  });

  it("falls back to a generic message when the repository throws a non-Error value", async () => {
    const { repo } = makeRepo();
    vi.spyOn(repo, "correctClientDebt").mockRejectedValueOnce("not an Error instance");
    const service = new ClientsService(repo);
    await expect(
      service.correctDebt({ clientId: "client-1", amount: -50, adminPassword: "pw", reason: "test" })
    ).rejects.toMatchObject({ statusCode: 400, message: "Erro ao corrigir débito" });
  });

  it("applies a valid correction", async () => {
    const { repo, clients } = makeRepo();
    const spy = vi.spyOn(repo, "correctClientDebt");
    const service = new ClientsService(repo);
    await service.correctDebt({ clientId: "client-1", amount: -30, adminPassword: "correct", reason: "goodwill" });
    expect(spy).toHaveBeenCalledWith("client-1", -30, "correct", "goodwill");
    expect(clients.get("client-1")?.balance).toBe(70);
  });

  it("rejects when the client disappears between the correction and the re-fetch", async () => {
    const { repo, clients } = makeRepo();
    vi.spyOn(repo, "correctClientDebt").mockImplementationOnce(async () => {
      clients.delete("client-1");
    });
    const service = new ClientsService(repo);
    await expect(
      service.correctDebt({ clientId: "client-1", amount: -30, adminPassword: "correct", reason: "goodwill" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("ClientsService.payOrder — no dangerous fallback", () => {
  it("rejects a nonexistent client", async () => {
    const { repo } = makeRepo();
    const service = new ClientsService(repo);
    await expect(
      service.payOrder({ clientId: "missing", orderId: "order-1", amount: 50, method: "DINHEIRO", receivedByUserId: "u1" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects an order that isn't in the pending list", async () => {
    const { repo } = makeRepo();
    const service = new ClientsService(repo);
    await expect(
      service.payOrder({ clientId: "client-1", orderId: "no-such-order", amount: 50, method: "DINHEIRO", receivedByUserId: "u1" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("surfaces applyFiadoPayment's error as a 400 instead of force-marking the order paid", async () => {
    const { repo } = makeRepo();
    vi.spyOn(repo, "applyFiadoPayment").mockRejectedValueOnce(new Error("Financial month 2026-06 is closed"));
    const service = new ClientsService(repo);

    await expect(
      service.payOrder({ clientId: "client-1", orderId: "order-1", amount: 50, method: "DINHEIRO", receivedByUserId: "u1" })
    ).rejects.toMatchObject({ statusCode: 400, message: "Financial month 2026-06 is closed" });

    // Critically: no compensating write was attempted. The old buggy fallback would have
    // called markOrderAsPaid + updateClientBalance(-order.totalAmount) here regardless of
    // why applyFiadoPayment failed — that entire code path no longer exists.
  });

  it("applies a valid payment", async () => {
    const { repo } = makeRepo();
    const spy = vi.spyOn(repo, "applyFiadoPayment");
    const service = new ClientsService(repo);
    await service.payOrder({ clientId: "client-1", orderId: "order-1", amount: 50, method: "PIX", receivedByUserId: "u1" });
    expect(spy).toHaveBeenCalledWith("client-1", "order-1", 50, "PIX", "u1");
  });

  it("defaults the amount to the order's full remaining balance when none is given", async () => {
    const { repo } = makeRepo();
    const spy = vi.spyOn(repo, "applyFiadoPayment");
    const service = new ClientsService(repo);
    await service.payOrder({ clientId: "client-1", orderId: "order-1", amount: undefined, method: "DINHEIRO", receivedByUserId: "u1" });
    expect(spy).toHaveBeenCalledWith("client-1", "order-1", 100, "DINHEIRO", "u1");
  });

  it("rejects when the client disappears between the payment and the re-fetch", async () => {
    const { repo, clients } = makeRepo();
    vi.spyOn(repo, "applyFiadoPayment").mockImplementationOnce(async () => {
      clients.delete("client-1");
    });
    const service = new ClientsService(repo);
    await expect(
      service.payOrder({ clientId: "client-1", orderId: "order-1", amount: 50, method: "DINHEIRO", receivedByUserId: "u1" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("ClientsService.payCascading", () => {
  it("rejects a nonexistent client", async () => {
    const { repo } = makeRepo();
    const service = new ClientsService(repo);
    await expect(
      service.payCascading({ clientId: "missing", amount: 100, method: "DINHEIRO", receivedByUserId: "u1" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects a non-positive amount", async () => {
    const { repo } = makeRepo();
    const service = new ClientsService(repo);
    await expect(
      service.payCascading({ clientId: "client-1", amount: 0, method: "DINHEIRO", receivedByUserId: "u1" })
    ).rejects.toThrow(HttpError);
  });

  it("translates a repository failure into a 400", async () => {
    const { repo } = makeRepo();
    vi.spyOn(repo, "applyCascadingFiadoPayment").mockRejectedValueOnce(new Error("Financial month 2026-06 is closed"));
    const service = new ClientsService(repo);
    await expect(
      service.payCascading({ clientId: "client-1", amount: 100, method: "DINHEIRO", receivedByUserId: "u1" })
    ).rejects.toMatchObject({ statusCode: 400, message: "Financial month 2026-06 is closed" });
  });

  it("applies a valid cascading payment and returns the paymentResult", async () => {
    const { repo } = makeRepo();
    const service = new ClientsService(repo);
    const result = await service.payCascading({ clientId: "client-1", amount: 100, method: "DINHEIRO", receivedByUserId: "u1" });
    expect((result.paymentResult as { totalApplied: number }).totalApplied).toBe(100);
  });

  it("rejects when the client disappears between the payment and the re-fetch", async () => {
    const { repo, clients } = makeRepo();
    vi.spyOn(repo, "applyCascadingFiadoPayment").mockImplementationOnce(async () => {
      clients.delete("client-1");
      return { totalApplied: 100 };
    });
    const service = new ClientsService(repo);
    await expect(
      service.payCascading({ clientId: "client-1", amount: 100, method: "DINHEIRO", receivedByUserId: "u1" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("ClientsService.removeOrderItem", () => {
  it("removes the item and returns the client with pending orders", async () => {
    const { repo } = makeRepo();
    const spy = vi.spyOn(repo, "removeFiadoOrderItem");
    const service = new ClientsService(repo);
    const result = await service.removeOrderItem({ clientId: "client-1", orderId: "order-1", orderItemId: "item-1" });
    expect(spy).toHaveBeenCalledWith("client-1", "order-1", "item-1");
    expect(result.id).toBe("client-1");
  });

  it("rejects when the client disappears between the removal and the re-fetch", async () => {
    const { repo, clients } = makeRepo();
    vi.spyOn(repo, "removeFiadoOrderItem").mockImplementationOnce(async () => {
      clients.delete("client-1");
    });
    const service = new ClientsService(repo);
    await expect(
      service.removeOrderItem({ clientId: "client-1", orderId: "order-1", orderItemId: "item-1" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
