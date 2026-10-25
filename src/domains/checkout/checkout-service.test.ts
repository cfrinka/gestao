import { describe, expect, it, vi } from "vitest";
import { CheckoutService } from "./checkout-service";
import type { CheckoutRepository, ProcessCheckoutInput } from "./repository";
import type { CheckoutCommand, IdempotencyReservation } from "./types";
import type { Order } from "@/lib/db-types";
import { HttpError } from "@/lib/api/http-errors";

/** Fully in-memory fake — mirrors the real reserve/complete/fail state machine without Firestore. */
class FakeCheckoutRepository implements CheckoutRepository {
  idempotencyStore = new Map<string, { requestHash: string; status: "PROCESSING" | "COMPLETED" | "FAILED"; response?: unknown }>();
  processCheckoutMock = vi.fn(
    async (input: ProcessCheckoutInput): Promise<Order> => ({
      id: "order-1",
      subtotal: 100,
      discount: input.discount,
      totalAmount: input.expectedTotal,
      cogsTotal: 50,
      payments: input.payments,
      cashRegisterId: input.cashRegisterId,
      createdAt: new Date(),
      items: [],
    })
  );
  consumeDiscountAuthorizationMock = vi.fn(async (_userId: string) => false);
  getOpenCashRegisterIdMock = vi.fn(async (_userId: string): Promise<string | null> => "register-1");
  getClientNameByIdMock = vi.fn(async (_clientId: string): Promise<string | null> => "Cliente Teste");

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
    const existing = this.idempotencyStore.get(`${input.ownerId}:${input.idempotencyKey}`);
    if (existing) {
      existing.status = "COMPLETED";
      existing.response = input.response;
    }
  }

  async markIdempotencyFailed(input: { ownerId: string; idempotencyKey: string; errorMessage: string }) {
    const existing = this.idempotencyStore.get(`${input.ownerId}:${input.idempotencyKey}`);
    if (existing) existing.status = "FAILED";
  }

  async processCheckout(input: ProcessCheckoutInput) {
    return this.processCheckoutMock(input);
  }
  async getOpenCashRegisterId(userId: string) {
    return this.getOpenCashRegisterIdMock(userId);
  }
  async consumeDiscountAuthorization(userId: string) {
    return this.consumeDiscountAuthorizationMock(userId);
  }
}

function baseCommand(overrides: Partial<CheckoutCommand> = {}): CheckoutCommand {
  return {
    userId: "user-1",
    userRole: "CASHIER",
    userName: "Test User",
    items: [{ productId: "p1", size: "", quantity: 1 }],
    payments: [{ method: "DINHEIRO", amount: 100 }],
    discount: 0,
    promoDiscount: 0,
    idempotencyKey: "key-1",
    subtotal: 100,
    ...overrides,
  };
}

describe("CheckoutService — validation", () => {
  it("rejects a missing idempotency key", async () => {
    const service = new CheckoutService(new FakeCheckoutRepository());
    await expect(service.execute(baseCommand({ idempotencyKey: "" }))).rejects.toThrow(HttpError);
  });

  it("rejects an empty cart", async () => {
    const service = new CheckoutService(new FakeCheckoutRepository());
    await expect(service.execute(baseCommand({ items: [] }))).rejects.toThrow(HttpError);
  });

  it.each([0, -2, 1.5])("rejects quantity %p before anything is reserved", async (quantity) => {
    const repo = new FakeCheckoutRepository();
    const service = new CheckoutService(repo);
    await expect(
      service.execute(baseCommand({ items: [{ productId: "p1", size: "", quantity }] }))
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(repo.idempotencyStore.size).toBe(0);
  });

  it("rejects a negative manual discount", async () => {
    const service = new CheckoutService(new FakeCheckoutRepository());
    await expect(service.execute(baseCommand({ discount: -10 }))).rejects.toMatchObject({ statusCode: 400 });
  });

  it("requires a payment for an immediate sale", async () => {
    const service = new CheckoutService(new FakeCheckoutRepository());
    await expect(service.execute(baseCommand({ payments: [] }))).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses a payment short of the total", async () => {
    const service = new CheckoutService(new FakeCheckoutRepository());
    await expect(
      service.execute(baseCommand({ payments: [{ method: "PIX", amount: 90 }] }))
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses a sale when the cashier has no open register", async () => {
    const repo = new FakeCheckoutRepository();
    repo.getOpenCashRegisterIdMock.mockResolvedValueOnce(null);
    const service = new CheckoutService(repo);
    await expect(service.execute(baseCommand())).rejects.toMatchObject({ statusCode: 409 });
    expect(repo.processCheckoutMock).not.toHaveBeenCalled();
  });
});

describe("CheckoutService — pay later", () => {
  it("blocks payLater for roles other than ADMIN or CASHIER", async () => {
    const service = new CheckoutService(new FakeCheckoutRepository());
    await expect(service.execute(baseCommand({ payLater: true, clientId: "c1", userRole: "SYSTEM" }))).rejects.toThrow(HttpError);
  });

  it("requires a clientId for payLater", async () => {
    const service = new CheckoutService(new FakeCheckoutRepository());
    await expect(service.execute(baseCommand({ payLater: true, userRole: "ADMIN" }))).rejects.toThrow(HttpError);
  });

  it("rejects payLater when the client doesn't exist", async () => {
    const repo = new FakeCheckoutRepository();
    repo.getClientNameByIdMock.mockResolvedValueOnce(null);
    const service = new CheckoutService(repo);
    await expect(
      service.execute(baseCommand({ payLater: true, clientId: "missing-client", userRole: "ADMIN" }))
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("hands the client and register to the single checkout transaction, with no payments", async () => {
    const repo = new FakeCheckoutRepository();
    const service = new CheckoutService(repo);
    const result = await service.execute(baseCommand({ payLater: true, clientId: "client-1", userRole: "CASHIER" }));

    expect(result.status).toBe(201);
    expect(repo.processCheckoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-1",
        clientName: "Cliente Teste",
        payLater: true,
        payments: [],
        change: 0,
        cashRegisterId: "register-1",
      })
    );
  });
});

describe("CheckoutService — payments and change", () => {
  it("keeps only the sale total in cash and records the rest as change", async () => {
    const repo = new FakeCheckoutRepository();
    const service = new CheckoutService(repo);
    await service.execute(baseCommand({ subtotal: 80, payments: [{ method: "DINHEIRO", amount: 100 }] }));

    expect(repo.processCheckoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payments: [{ method: "DINHEIRO", amount: 80 }],
        change: 20,
        expectedTotal: 80,
      })
    );
  });

  it("refuses an overpayment by card, which cannot be given back as change", async () => {
    const service = new CheckoutService(new FakeCheckoutRepository());
    await expect(
      service.execute(baseCommand({ subtotal: 80, payments: [{ method: "CREDITO", amount: 100 }] }))
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("CheckoutService — cashier discount cap", () => {
  it("allows a manual discount at or under 10% of subtotal without authorization", async () => {
    const repo = new FakeCheckoutRepository();
    const service = new CheckoutService(repo);
    await service.execute(baseCommand({ discount: 10, payments: [{ method: "DINHEIRO", amount: 90 }] }));
    expect(repo.processCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({ discount: 10, expectedTotal: 90 }));
    expect(repo.consumeDiscountAuthorizationMock).not.toHaveBeenCalled();
  });

  it("refuses a manual discount over 10% when there is no authorization grant", async () => {
    const repo = new FakeCheckoutRepository();
    const service = new CheckoutService(repo);
    await expect(
      service.execute(baseCommand({ discount: 50, payments: [{ method: "DINHEIRO", amount: 50 }] }))
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.processCheckoutMock).not.toHaveBeenCalled();
  });

  it("honors the full manual discount when a valid authorization grant is consumed", async () => {
    const repo = new FakeCheckoutRepository();
    repo.consumeDiscountAuthorizationMock.mockResolvedValue(true);
    const service = new CheckoutService(repo);
    await service.execute(baseCommand({ discount: 50, payments: [{ method: "DINHEIRO", amount: 50 }] }));
    expect(repo.processCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({ discount: 50 }));
  });

  it("never caps an ADMIN's manual discount, and never consumes a grant for admins", async () => {
    const repo = new FakeCheckoutRepository();
    const service = new CheckoutService(repo);
    await service.execute(baseCommand({ discount: 90, userRole: "ADMIN", payments: [{ method: "DINHEIRO", amount: 10 }] }));
    expect(repo.processCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({ discount: 90 }));
    expect(repo.consumeDiscountAuthorizationMock).not.toHaveBeenCalled();
  });

  it("adds promoDiscount on top of the manual discount without counting it toward the cap", async () => {
    const repo = new FakeCheckoutRepository();
    const service = new CheckoutService(repo);
    await service.execute(baseCommand({ discount: 10, promoDiscount: 20, payments: [{ method: "DINHEIRO", amount: 70 }] }));
    expect(repo.processCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({ discount: 30, expectedTotal: 70 }));
    expect(repo.consumeDiscountAuthorizationMock).not.toHaveBeenCalled();
  });
});

describe("CheckoutService — idempotency", () => {
  it("returns the cached response on a completed retry without re-running processCheckout", async () => {
    const repo = new FakeCheckoutRepository();
    const service = new CheckoutService(repo);
    const command = baseCommand();

    const first = await service.execute(command);
    expect(first.status).toBe(201);

    const second = await service.execute(command);
    expect(second.status).toBe(200);
    expect(repo.processCheckoutMock).toHaveBeenCalledTimes(1);
    expect((second.body as Order).id).toBe((first.body as Order).id);
  });

  it("recovers a sale whose response was lost even after its discount grant was used up", async () => {
    const repo = new FakeCheckoutRepository();
    repo.consumeDiscountAuthorizationMock.mockResolvedValueOnce(true).mockResolvedValue(false);
    const service = new CheckoutService(repo);
    const command = baseCommand({ discount: 50, payments: [{ method: "DINHEIRO", amount: 50 }] });

    await service.execute(command);
    const retry = await service.execute(command);

    expect(retry.status).toBe(200);
    expect(repo.processCheckoutMock).toHaveBeenCalledTimes(1);
  });

  it("marks idempotency failed (allowing retry) when processCheckout itself throws", async () => {
    const repo = new FakeCheckoutRepository();
    repo.processCheckoutMock.mockRejectedValueOnce(new HttpError(409, "Estoque insuficiente"));
    const service = new CheckoutService(repo);
    const command = baseCommand();

    await expect(service.execute(command)).rejects.toMatchObject({ statusCode: 409 });

    const retry = await service.execute(command);
    expect(retry.status).toBe(201);
    expect(repo.processCheckoutMock).toHaveBeenCalledTimes(2);
  });

  it("rejects idempotency key reuse with a different payload as a conflict", async () => {
    const repo = new FakeCheckoutRepository();
    const service = new CheckoutService(repo);
    await service.execute(baseCommand({ idempotencyKey: "same-key" }));
    await expect(
      service.execute(baseCommand({ idempotencyKey: "same-key", discount: 5, payments: [{ method: "DINHEIRO", amount: 95 }] }))
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("returns 409 while the same idempotency key is still being processed", async () => {
    const repo = new FakeCheckoutRepository();
    let finish: (order: Order) => void = () => {};
    repo.processCheckoutMock.mockImplementationOnce(() => new Promise<Order>((resolve) => (finish = resolve)));
    const service = new CheckoutService(repo);
    const command = baseCommand({ idempotencyKey: "in-progress-key" });

    const first = service.execute(command);
    await vi.waitFor(() => expect(repo.processCheckoutMock).toHaveBeenCalledTimes(1));
    const second = await service.execute(command);
    expect(second.status).toBe(409);

    finish({ id: "order-1", subtotal: 100, discount: 0, totalAmount: 100, payments: [], createdAt: new Date() });
    await first;
  });

  it("lets an unexpected non-Error value propagate unchanged", async () => {
    const repo = new FakeCheckoutRepository();
    repo.processCheckoutMock.mockRejectedValueOnce("not an Error instance");
    const service = new CheckoutService(repo);
    await expect(service.execute(baseCommand({ idempotencyKey: "non-error-fail-key" }))).rejects.toBe(
      "not an Error instance"
    );
  });
});
