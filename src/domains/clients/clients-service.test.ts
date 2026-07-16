import { describe, expect, it, vi } from "vitest";
import { ClientsService } from "./clients-service";
import type { ClientsRepository } from "./repository";
import type { Client, Order } from "@/lib/db-types";
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
    subtotal: 100,
    discount: 0,
    totalAmount: 100,
    payments: [],
    createdAt: new Date(),
    isPaidLater: true,
    remainingAmount: 100,
    ...overrides,
  };
}

class FakeClientsRepository implements ClientsRepository {
  clients = new Map<string, Client>([["client-1", makeClient()]]);
  pendingOrders: Order[] = [makePendingOrder()];

  listClientsMock = vi.fn(async () => Array.from(this.clients.values()));
  createClientMock = vi.fn(async (data: { name: string; phone?: string; email?: string; notes?: string }): Promise<Client> => ({
    id: "new-client",
    balance: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
  }));
  updateClientMock = vi.fn(async (_clientId: string, _data: Record<string, unknown>) => {});
  deleteClientMock = vi.fn(async (_clientId: string) => {});
  correctClientDebtMock = vi.fn(async (_clientId: string, _amount: number, _adminPassword: string, _reason: string) => {});
  applyCascadingFiadoPaymentMock = vi.fn(async (_clientId: string, _amount: number, _method: string, _receivedByUserId?: string) => ({
    totalApplied: 100,
  }));
  applyFiadoPaymentMock = vi.fn(async (_clientId: string, _orderId: string, _amount: number, _method: string, _receivedByUserId?: string) => {});
  removeFiadoOrderItemMock = vi.fn(async (_clientId: string, _orderId: string, _orderItemId: string) => {});

  async listClients() {
    return this.listClientsMock();
  }
  async getClient(clientId: string) {
    return this.clients.get(clientId) || null;
  }
  async getClientPendingOrders(_clientId: string) {
    return this.pendingOrders;
  }
  async createClient(data: Parameters<ClientsRepository["createClient"]>[0]) {
    return this.createClientMock(data);
  }
  async updateClient(clientId: string, data: Parameters<ClientsRepository["updateClient"]>[1]) {
    return this.updateClientMock(clientId, data);
  }
  async deleteClient(clientId: string) {
    return this.deleteClientMock(clientId);
  }
  async correctClientDebt(clientId: string, amount: number, adminPassword: string, reason: string) {
    return this.correctClientDebtMock(clientId, amount, adminPassword, reason);
  }
  async applyCascadingFiadoPayment(clientId: string, amount: number, method: string, receivedByUserId?: string) {
    return this.applyCascadingFiadoPaymentMock(clientId, amount, method, receivedByUserId);
  }
  async applyFiadoPayment(clientId: string, orderId: string, amount: number, method: string, receivedByUserId?: string) {
    return this.applyFiadoPaymentMock(clientId, orderId, amount, method, receivedByUserId);
  }
  async removeFiadoOrderItem(clientId: string, orderId: string, orderItemId: string) {
    return this.removeFiadoOrderItemMock(clientId, orderId, orderItemId);
  }
}

describe("ClientsService.list", () => {
  it("delegates to the repository", async () => {
    const repo = new FakeClientsRepository();
    const service = new ClientsService(repo);
    const result = await service.list();
    expect(result).toHaveLength(1);
    expect(repo.listClientsMock).toHaveBeenCalled();
  });
});

describe("ClientsService.get", () => {
  it("rejects a nonexistent client", async () => {
    const service = new ClientsService(new FakeClientsRepository());
    await expect(service.get("missing")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns the client with its pending orders", async () => {
    const repo = new FakeClientsRepository();
    const service = new ClientsService(repo);
    const result = await service.get("client-1");
    expect(result.id).toBe("client-1");
    expect(result.pendingOrders).toHaveLength(1);
  });
});

describe("ClientsService.update", () => {
  it("rejects a nonexistent client", async () => {
    const service = new ClientsService(new FakeClientsRepository());
    await expect(service.update({ clientId: "missing", name: "New Name" })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("updates an existing client", async () => {
    const repo = new FakeClientsRepository();
    const service = new ClientsService(repo);
    const updated = await service.update({ clientId: "client-1", name: "Renamed", phone: "123", email: "a@b.com", notes: "note" });
    expect(repo.updateClientMock).toHaveBeenCalledWith("client-1", { name: "Renamed", phone: "123", email: "a@b.com", notes: "note" });
    expect(updated.id).toBe("client-1");
  });

  it("rejects when the client disappears between the update and the re-fetch", async () => {
    const repo = new FakeClientsRepository();
    repo.updateClientMock.mockImplementationOnce(async () => {
      repo.clients.delete("client-1");
    });
    const service = new ClientsService(repo);
    await expect(service.update({ clientId: "client-1", name: "Renamed" })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("ClientsService.create", () => {
  it("rejects a missing name", async () => {
    const service = new ClientsService(new FakeClientsRepository());
    await expect(service.create({ name: "" })).rejects.toThrow(HttpError);
  });

  it("creates a client with a valid name", async () => {
    const repo = new FakeClientsRepository();
    const service = new ClientsService(repo);
    const client = await service.create({ name: "New Client" });
    expect(client.id).toBe("new-client");
    expect(repo.createClientMock).toHaveBeenCalledWith({ name: "New Client", phone: undefined, email: undefined, notes: undefined });
  });
});

describe("ClientsService.remove", () => {
  it("rejects a nonexistent client", async () => {
    const service = new ClientsService(new FakeClientsRepository());
    await expect(service.remove("missing")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects deleting a client with a pending balance", async () => {
    const service = new ClientsService(new FakeClientsRepository());
    await expect(service.remove("client-1")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("deletes a client with a zero balance", async () => {
    const repo = new FakeClientsRepository();
    repo.clients.set("client-1", makeClient({ balance: 0 }));
    const service = new ClientsService(repo);
    await service.remove("client-1");
    expect(repo.deleteClientMock).toHaveBeenCalledWith("client-1");
  });
});

describe("ClientsService.correctDebt", () => {
  it("rejects a nonexistent client", async () => {
    const service = new ClientsService(new FakeClientsRepository());
    await expect(
      service.correctDebt({ clientId: "missing", amount: -50, adminPassword: "pw", reason: "test" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects a missing admin password or reason", async () => {
    const service = new ClientsService(new FakeClientsRepository());
    await expect(
      service.correctDebt({ clientId: "client-1", amount: -50, adminPassword: "", reason: "test" })
    ).rejects.toThrow(HttpError);
    await expect(
      service.correctDebt({ clientId: "client-1", amount: -50, adminPassword: "pw", reason: "" })
    ).rejects.toThrow(HttpError);
  });

  it("translates 'Invalid admin password' into a 403", async () => {
    const repo = new FakeClientsRepository();
    repo.correctClientDebtMock.mockRejectedValueOnce(new Error("Invalid admin password"));
    const service = new ClientsService(repo);

    await expect(
      service.correctDebt({ clientId: "client-1", amount: -50, adminPassword: "wrong", reason: "test" })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects a zero correction amount", async () => {
    const service = new ClientsService(new FakeClientsRepository());
    await expect(
      service.correctDebt({ clientId: "client-1", amount: 0, adminPassword: "pw", reason: "test" })
    ).rejects.toThrow(HttpError);
  });

  it("translates a generic repository error into a 400 with its own message", async () => {
    const repo = new FakeClientsRepository();
    repo.correctClientDebtMock.mockRejectedValueOnce(new Error("Financial month 2026-06 is closed"));
    const service = new ClientsService(repo);
    await expect(
      service.correctDebt({ clientId: "client-1", amount: -50, adminPassword: "pw", reason: "test" })
    ).rejects.toMatchObject({ statusCode: 400, message: "Financial month 2026-06 is closed" });
  });

  it("falls back to a generic message when the repository throws a non-Error value", async () => {
    const repo = new FakeClientsRepository();
    repo.correctClientDebtMock.mockRejectedValueOnce("not an Error instance");
    const service = new ClientsService(repo);
    await expect(
      service.correctDebt({ clientId: "client-1", amount: -50, adminPassword: "pw", reason: "test" })
    ).rejects.toMatchObject({ statusCode: 400, message: "Erro ao corrigir débito" });
  });

  it("applies a valid correction", async () => {
    const repo = new FakeClientsRepository();
    const service = new ClientsService(repo);
    await service.correctDebt({ clientId: "client-1", amount: -30, adminPassword: "correct", reason: "goodwill" });
    expect(repo.correctClientDebtMock).toHaveBeenCalledWith("client-1", -30, "correct", "goodwill");
  });

  it("rejects when the client disappears between the correction and the re-fetch", async () => {
    const repo = new FakeClientsRepository();
    repo.correctClientDebtMock.mockImplementationOnce(async () => {
      repo.clients.delete("client-1");
    });
    const service = new ClientsService(repo);
    await expect(
      service.correctDebt({ clientId: "client-1", amount: -30, adminPassword: "correct", reason: "goodwill" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("ClientsService.payOrder — no dangerous fallback", () => {
  it("rejects a nonexistent client", async () => {
    const service = new ClientsService(new FakeClientsRepository());
    await expect(
      service.payOrder({ clientId: "missing", orderId: "order-1", amount: 50, method: "DINHEIRO", receivedByUserId: "u1" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects an order that isn't in the pending list", async () => {
    const service = new ClientsService(new FakeClientsRepository());
    await expect(
      service.payOrder({ clientId: "client-1", orderId: "no-such-order", amount: 50, method: "DINHEIRO", receivedByUserId: "u1" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("surfaces applyFiadoPayment's error as a 400 instead of force-marking the order paid", async () => {
    const repo = new FakeClientsRepository();
    repo.applyFiadoPaymentMock.mockRejectedValueOnce(new Error("Financial month 2026-06 is closed"));
    const service = new ClientsService(repo);

    await expect(
      service.payOrder({ clientId: "client-1", orderId: "order-1", amount: 50, method: "DINHEIRO", receivedByUserId: "u1" })
    ).rejects.toMatchObject({ statusCode: 400, message: "Financial month 2026-06 is closed" });

    // Critically: no compensating write was attempted. The old buggy fallback would have
    // called markOrderAsPaid + updateClientBalance(-order.totalAmount) here regardless of
    // why applyFiadoPayment failed — that entire code path no longer exists.
  });

  it("applies a valid payment", async () => {
    const repo = new FakeClientsRepository();
    const service = new ClientsService(repo);
    await service.payOrder({ clientId: "client-1", orderId: "order-1", amount: 50, method: "PIX", receivedByUserId: "u1" });
    expect(repo.applyFiadoPaymentMock).toHaveBeenCalledWith("client-1", "order-1", 50, "PIX", "u1");
  });

  it("defaults the amount to the order's full remaining balance when none is given", async () => {
    const repo = new FakeClientsRepository();
    const service = new ClientsService(repo);
    await service.payOrder({ clientId: "client-1", orderId: "order-1", amount: undefined, method: "DINHEIRO", receivedByUserId: "u1" });
    expect(repo.applyFiadoPaymentMock).toHaveBeenCalledWith("client-1", "order-1", 100, "DINHEIRO", "u1");
  });

  it("rejects when the client disappears between the payment and the re-fetch", async () => {
    const repo = new FakeClientsRepository();
    repo.applyFiadoPaymentMock.mockImplementationOnce(async () => {
      repo.clients.delete("client-1");
    });
    const service = new ClientsService(repo);
    await expect(
      service.payOrder({ clientId: "client-1", orderId: "order-1", amount: 50, method: "DINHEIRO", receivedByUserId: "u1" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("ClientsService.payCascading", () => {
  it("rejects a nonexistent client", async () => {
    const service = new ClientsService(new FakeClientsRepository());
    await expect(
      service.payCascading({ clientId: "missing", amount: 100, method: "DINHEIRO", receivedByUserId: "u1" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects a non-positive amount", async () => {
    const service = new ClientsService(new FakeClientsRepository());
    await expect(
      service.payCascading({ clientId: "client-1", amount: 0, method: "DINHEIRO", receivedByUserId: "u1" })
    ).rejects.toThrow(HttpError);
  });

  it("translates a repository failure into a 400", async () => {
    const repo = new FakeClientsRepository();
    repo.applyCascadingFiadoPaymentMock.mockRejectedValueOnce(new Error("Financial month 2026-06 is closed"));
    const service = new ClientsService(repo);
    await expect(
      service.payCascading({ clientId: "client-1", amount: 100, method: "DINHEIRO", receivedByUserId: "u1" })
    ).rejects.toMatchObject({ statusCode: 400, message: "Financial month 2026-06 is closed" });
  });

  it("applies a valid cascading payment and returns the paymentResult", async () => {
    const repo = new FakeClientsRepository();
    const service = new ClientsService(repo);
    const result = await service.payCascading({ clientId: "client-1", amount: 100, method: "DINHEIRO", receivedByUserId: "u1" });
    expect((result.paymentResult as { totalApplied: number }).totalApplied).toBe(100);
  });

  it("rejects when the client disappears between the payment and the re-fetch", async () => {
    const repo = new FakeClientsRepository();
    repo.applyCascadingFiadoPaymentMock.mockImplementationOnce(async () => {
      repo.clients.delete("client-1");
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
    const repo = new FakeClientsRepository();
    const service = new ClientsService(repo);
    const result = await service.removeOrderItem({ clientId: "client-1", orderId: "order-1", orderItemId: "item-1" });
    expect(repo.removeFiadoOrderItemMock).toHaveBeenCalledWith("client-1", "order-1", "item-1");
    expect(result.id).toBe("client-1");
  });

  it("rejects when the client disappears between the removal and the re-fetch", async () => {
    const repo = new FakeClientsRepository();
    repo.removeFiadoOrderItemMock.mockImplementationOnce(async () => {
      repo.clients.delete("client-1");
    });
    const service = new ClientsService(repo);
    await expect(
      service.removeOrderItem({ clientId: "client-1", orderId: "order-1", orderItemId: "item-1" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
