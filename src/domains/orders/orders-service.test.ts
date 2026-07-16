import { describe, expect, it, vi } from "vitest";
import { OrdersService } from "./orders-service";
import type { OrdersRepository } from "./repository";
import type { Order } from "@/lib/db-types";
import { HttpError } from "@/lib/api/http-errors";

vi.mock("@/domains/products/products-db", () => ({
  getProduct: vi.fn(async (productId: string) => ({ id: productId, name: `Product ${productId}` })),
}));

class FakeOrdersRepository implements OrdersRepository {
  getOrdersMock = vi.fn(async (_startDate?: Date, _endDate?: Date): Promise<Order[]> => []);
  cancelOrderMock = vi.fn(
    async (input: { orderId: string; actorId: string; actorRole: string; reason?: string }): Promise<Order> => ({
      id: input.orderId,
      subtotal: 100,
      discount: 0,
      totalAmount: 100,
      payments: [],
      createdAt: new Date(),
      isCancelled: true,
    })
  );
  updateOrderMock = vi.fn(
    async (input: {
      orderId: string;
      discount: number;
      payments: Array<{ method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX"; amount: number }>;
      actorId: string;
      actorRole: string;
    }): Promise<Order> => ({
      id: input.orderId,
      subtotal: 100,
      discount: input.discount,
      totalAmount: 100 - input.discount,
      payments: input.payments,
      createdAt: new Date(),
    })
  );

  async getOrders(startDate?: Date, endDate?: Date) {
    return this.getOrdersMock(startDate, endDate);
  }
  async cancelOrder(input: Parameters<OrdersRepository["cancelOrder"]>[0]) {
    return this.cancelOrderMock(input);
  }
  async updateOrder(input: Parameters<OrdersRepository["updateOrder"]>[0]) {
    return this.updateOrderMock(input);
  }
}

const recentAuthTime = Math.floor(Date.now() / 1000);
const staleAuthTime = recentAuthTime - 10 * 60; // 10 minutes ago, outside the 5-minute window

describe("OrdersService.cancel", () => {
  it("rejects a missing orderId", async () => {
    const service = new OrdersService(new FakeOrdersRepository());
    await expect(
      service.cancel({ orderId: "", actorId: "admin-1", actorRole: "ADMIN", authTime: recentAuthTime })
    ).rejects.toThrow(HttpError);
  });

  it("rejects stale re-authentication", async () => {
    const service = new OrdersService(new FakeOrdersRepository());
    await expect(
      service.cancel({ orderId: "order-1", actorId: "admin-1", actorRole: "ADMIN", authTime: staleAuthTime })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects when authTime is missing entirely", async () => {
    const service = new OrdersService(new FakeOrdersRepository());
    await expect(
      service.cancel({ orderId: "order-1", actorId: "admin-1", actorRole: "ADMIN" })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("cancels with recent auth and calls the repository", async () => {
    const repo = new FakeOrdersRepository();
    const service = new OrdersService(repo);
    const result = await service.cancel({
      orderId: "order-1",
      reason: "test",
      actorId: "admin-1",
      actorRole: "ADMIN",
      authTime: recentAuthTime,
    });
    expect(repo.cancelOrderMock).toHaveBeenCalledWith({
      orderId: "order-1",
      reason: "test",
      actorId: "admin-1",
      actorRole: "ADMIN",
    });
    expect(result.isCancelled).toBe(true);
  });

  it("converts a repository error into a 400 HttpError with the original message", async () => {
    const repo = new FakeOrdersRepository();
    repo.cancelOrderMock.mockRejectedValueOnce(new Error("Order is already cancelled"));
    const service = new OrdersService(repo);

    await expect(
      service.cancel({ orderId: "order-1", actorId: "admin-1", actorRole: "ADMIN", authTime: recentAuthTime })
    ).rejects.toMatchObject({ statusCode: 400, message: "Order is already cancelled" });
  });

  it("falls back to a generic message when the repository throws a non-Error value", async () => {
    const repo = new FakeOrdersRepository();
    repo.cancelOrderMock.mockRejectedValueOnce("not an Error instance");
    const service = new OrdersService(repo);

    await expect(
      service.cancel({ orderId: "order-1", actorId: "admin-1", actorRole: "ADMIN", authTime: recentAuthTime })
    ).rejects.toMatchObject({ statusCode: 400, message: "Erro ao cancelar venda" });
  });
});

describe("OrdersService.update", () => {
  it("rejects a missing orderId", async () => {
    const service = new OrdersService(new FakeOrdersRepository());
    await expect(
      service.update({ orderId: "", discount: 0, payments: [], actorId: "admin-1", actorRole: "ADMIN" })
    ).rejects.toThrow(HttpError);
  });

  it("calls the repository with the given command", async () => {
    const repo = new FakeOrdersRepository();
    const service = new OrdersService(repo);
    const payments = [{ method: "DINHEIRO" as const, amount: 80 }];
    const result = await service.update({ orderId: "order-1", discount: 20, payments, actorId: "admin-1", actorRole: "ADMIN" });
    expect(repo.updateOrderMock).toHaveBeenCalledWith({
      orderId: "order-1",
      discount: 20,
      payments,
      actorId: "admin-1",
      actorRole: "ADMIN",
    });
    expect(result.totalAmount).toBe(80);
  });
});

describe("OrdersService.list", () => {
  it("enriches each item with product details", async () => {
    const repo = new FakeOrdersRepository();
    repo.getOrdersMock.mockResolvedValueOnce([
      {
        id: "order-1",
        subtotal: 100,
        discount: 0,
        totalAmount: 100,
        payments: [],
        createdAt: new Date(),
        items: [{ id: "item-1", orderId: "order-1", productId: "p1", size: "M", quantity: 1, unitCost: 5, unitPrice: 10, totalCost: 5, totalRevenue: 10, profit: 5 }],
      },
    ]);
    const service = new OrdersService(repo);
    const result = (await service.list({})) as Array<{ items: Array<{ product?: { name?: string } }> }>;
    expect(result[0].items[0].product?.name).toBe("Product p1");
  });

  it("converts Firestore-timestamp-like createdAt values in paymentHistory, leaving plain values alone", async () => {
    const repo = new FakeOrdersRepository();
    const asDate = new Date("2026-01-01T00:00:00.000Z");
    repo.getOrdersMock.mockResolvedValueOnce([
      {
        id: "order-1",
        subtotal: 100,
        discount: 0,
        totalAmount: 100,
        payments: [],
        createdAt: new Date(),
        items: [],
        paymentHistory: [
          { amount: 50, createdAt: { toDate: () => asDate } },
          { amount: 50, createdAt: "2026-01-02T00:00:00.000Z" },
        ],
      } as unknown as Order,
    ]);
    const service = new OrdersService(repo);
    const result = (await service.list({})) as Array<{ paymentHistory: Array<{ createdAt: unknown }> }>;
    expect(result[0].paymentHistory[0].createdAt).toBe(asDate);
    expect(result[0].paymentHistory[1].createdAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("omits paymentHistory entirely when the order doesn't have one", async () => {
    const repo = new FakeOrdersRepository();
    repo.getOrdersMock.mockResolvedValueOnce([
      { id: "order-1", subtotal: 100, discount: 0, totalAmount: 100, payments: [], createdAt: new Date(), items: [] },
    ]);
    const service = new OrdersService(repo);
    const result = (await service.list({})) as Array<Record<string, unknown>>;
    expect("paymentHistory" in result[0]).toBe(false);
  });

  it("treats a missing items array as empty instead of throwing", async () => {
    const repo = new FakeOrdersRepository();
    repo.getOrdersMock.mockResolvedValueOnce([
      { id: "order-1", subtotal: 100, discount: 0, totalAmount: 100, payments: [], createdAt: new Date() } as unknown as Order,
    ]);
    const service = new OrdersService(repo);
    const result = (await service.list({})) as Array<{ items: unknown[] }>;
    expect(result[0].items).toEqual([]);
  });
});
