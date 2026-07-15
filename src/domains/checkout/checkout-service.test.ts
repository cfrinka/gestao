import { describe, expect, it, vi } from "vitest";
import { CheckoutService } from "./checkout-service";
import type { CheckoutRepository } from "./repository";
import type { CheckoutCommand, IdempotencyReservation } from "./types";
import type { Order, PaymentMethod } from "@/lib/db-types";
import { HttpError } from "@/lib/api/http-errors";

/** Fully in-memory fake — mirrors the real reserve/complete/fail state machine without Firestore. */
class FakeCheckoutRepository implements CheckoutRepository {
  idempotencyStore = new Map<string, { requestHash: string; status: "PROCESSING" | "COMPLETED" | "FAILED"; response?: unknown }>();
  processCheckoutMock = vi.fn(
    async (_input: Parameters<CheckoutRepository["processCheckout"]>[0]): Promise<Order> => ({
      id: "order-1",
      subtotal: 100,
      discount: 0,
      totalAmount: 100,
      cogsTotal: 50,
      payments: [{ method: "DINHEIRO", amount: 100 }] as PaymentMethod[],
      createdAt: new Date(),
      items: [],
    })
  );
  consumeDiscountAuthorizationMock = vi.fn(async (_userId: string) => false);
  getOpenCashRegisterMock = vi.fn(async (_userId: string): Promise<{ id: string } | null> => null);
  updateCashRegisterSalesMock = vi.fn(async (_registerId: string, _payments: PaymentMethod[], _totalAmount: number) => {});
  updateClientBalanceMock = vi.fn(async (_clientId: string, _amount: number) => {});
  getClientNameByIdMock = vi.fn(async (_clientId: string) => "Cliente Teste");

  async getClientNameById(clientId: string) {
    return this.getClientNameByIdMock(clientId);
  }

  async reserveIdempotency(input: { ownerId: string; idempotencyKey: string; requestHash: string }): Promise<IdempotencyReservation> {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotencyStore.get(key);

    if (!existing) {
      this.idempotencyStore.set(key, { requestHash: input.requestHash, status: "PROCESSING" });
      return { type: "new" };
    }

    if (existing.requestHash !== input.requestHash) {
      return { type: "conflict" };
    }
    if (existing.status === "COMPLETED") {
      return { type: "completed", response: existing.response };
    }
    if (existing.status === "PROCESSING") {
      return { type: "in_progress" };
    }

    existing.status = "PROCESSING";
    return { type: "new" };
  }

  async markIdempotencyCompleted(input: { ownerId: string; idempotencyKey: string; response: unknown }) {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotencyStore.get(key);
    if (existing) {
      existing.status = "COMPLETED";
      existing.response = input.response;
    }
  }

  async markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }) {
    const key = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.idempotencyStore.get(key);
    if (existing) existing.status = "FAILED";
  }

  async processCheckout(input: Parameters<CheckoutRepository["processCheckout"]>[0]) {
    return this.processCheckoutMock(input);
  }
  async updateClientBalance(clientId: string, amount: number) {
    return this.updateClientBalanceMock(clientId, amount);
  }
  async getOpenCashRegister(userId: string) {
    return this.getOpenCashRegisterMock(userId);
  }
  async updateCashRegisterSales(registerId: string, payments: PaymentMethod[], totalAmount: number) {
    return this.updateCashRegisterSalesMock(registerId, payments, totalAmount);
  }
  async consumeDiscountAuthorization(userId: string) {
    return this.consumeDiscountAuthorizationMock(userId);
  }
}

function baseCommand(overrides: Partial<CheckoutCommand> = {}): CheckoutCommand {
  return {
    userId: "user-1",
    userRole: "CASHIER",
    items: [{ productId: "p1", size: "", quantity: 1 }],
    payments: [{ method: "DINHEIRO", amount: 100 }],
    discount: 0,
    promoDiscount: 0,
    idempotencyKey: "key-1",
    subtotal: 100,
    ...overrides,
  };
}

describe("CheckoutService", () => {
  it("rejects a missing idempotency key", async () => {
    const service = new CheckoutService(new FakeCheckoutRepository());
    await expect(service.execute(baseCommand({ idempotencyKey: "" }))).rejects.toThrow(HttpError);
  });

  it("rejects an empty cart", async () => {
    const service = new CheckoutService(new FakeCheckoutRepository());
    await expect(service.execute(baseCommand({ items: [] }))).rejects.toThrow(HttpError);
  });

  it("blocks payLater for non-admin roles", async () => {
    const service = new CheckoutService(new FakeCheckoutRepository());
    await expect(service.execute(baseCommand({ payLater: true, clientId: "c1", userRole: "CASHIER" }))).rejects.toThrow(HttpError);
  });

  it("requires a clientId for payLater", async () => {
    const service = new CheckoutService(new FakeCheckoutRepository());
    await expect(service.execute(baseCommand({ payLater: true, userRole: "ADMIN" }))).rejects.toThrow(HttpError);
  });

  describe("cashier discount cap", () => {
    it("allows a manual discount at or under 10% of subtotal without authorization", async () => {
      const repo = new FakeCheckoutRepository();
      const service = new CheckoutService(repo);
      await service.execute(baseCommand({ discount: 10, subtotal: 100 }));
      expect(repo.processCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({ discount: 10 }));
      expect(repo.consumeDiscountAuthorizationMock).not.toHaveBeenCalled();
    });

    it("caps a manual discount over 10% when there is no authorization grant", async () => {
      const repo = new FakeCheckoutRepository();
      repo.consumeDiscountAuthorizationMock.mockResolvedValue(false);
      const service = new CheckoutService(repo);
      await service.execute(baseCommand({ discount: 50, subtotal: 100 }));
      expect(repo.processCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({ discount: 10 }));
    });

    it("honors the full manual discount when a valid authorization grant is consumed", async () => {
      const repo = new FakeCheckoutRepository();
      repo.consumeDiscountAuthorizationMock.mockResolvedValue(true);
      const service = new CheckoutService(repo);
      await service.execute(baseCommand({ discount: 50, subtotal: 100 }));
      expect(repo.processCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({ discount: 50 }));
    });

    it("never caps an ADMIN's manual discount, and never consumes a grant for admins", async () => {
      const repo = new FakeCheckoutRepository();
      const service = new CheckoutService(repo);
      await service.execute(baseCommand({ discount: 90, subtotal: 100, userRole: "ADMIN" }));
      expect(repo.processCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({ discount: 90 }));
      expect(repo.consumeDiscountAuthorizationMock).not.toHaveBeenCalled();
    });

    it("always adds promoDiscount on top of the (possibly capped) manual discount", async () => {
      const repo = new FakeCheckoutRepository();
      const service = new CheckoutService(repo);
      await service.execute(baseCommand({ discount: 50, promoDiscount: 20, subtotal: 100 }));
      // manual capped to 10 + promo 20 = 30
      expect(repo.processCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({ discount: 30 }));
    });
  });

  describe("idempotency", () => {
    it("returns the cached response on a completed retry without re-running processCheckout", async () => {
      const repo = new FakeCheckoutRepository();
      const service = new CheckoutService(repo);
      const command = baseCommand();

      const first = await service.execute(command);
      expect(first.status).toBe(201);
      expect(repo.processCheckoutMock).toHaveBeenCalledTimes(1);

      const second = await service.execute(command);
      expect(second.status).toBe(200);
      expect(repo.processCheckoutMock).toHaveBeenCalledTimes(1);
      expect((second.body as Order).id).toBe((first.body as Order).id);
    });

    it("marks idempotency completed BEFORE running post-sale side effects, so a failure there doesn't allow a duplicate order", async () => {
      const repo = new FakeCheckoutRepository();
      repo.getOpenCashRegisterMock.mockImplementation(async () => {
        throw new Error("simulated post-sale failure");
      });
      const service = new CheckoutService(repo);
      const command = baseCommand();

      const first = await service.execute(command);
      expect(first.status).toBe(201);
      expect(repo.processCheckoutMock).toHaveBeenCalledTimes(1);

      const second = await service.execute(command);
      expect(second.status).toBe(200);
      expect(repo.processCheckoutMock).toHaveBeenCalledTimes(1);
    });

    it("marks idempotency failed (allowing retry) when processCheckout itself throws", async () => {
      const repo = new FakeCheckoutRepository();
      repo.processCheckoutMock.mockRejectedValueOnce(new Error("insufficient stock"));
      const service = new CheckoutService(repo);
      const command = baseCommand();

      await expect(service.execute(command)).rejects.toThrow("insufficient stock");
      expect(repo.processCheckoutMock).toHaveBeenCalledTimes(1);

      // Retry should be allowed to run processCheckout again since nothing was created.
      const retry = await service.execute(command);
      expect(retry.status).toBe(201);
      expect(repo.processCheckoutMock).toHaveBeenCalledTimes(2);
    });

    it("rejects idempotency key reuse with a different payload as a conflict", async () => {
      const repo = new FakeCheckoutRepository();
      const service = new CheckoutService(repo);
      await service.execute(baseCommand({ idempotencyKey: "same-key", discount: 0 }));
      await expect(service.execute(baseCommand({ idempotencyKey: "same-key", discount: 5 }))).rejects.toThrow(HttpError);
    });
  });
});
