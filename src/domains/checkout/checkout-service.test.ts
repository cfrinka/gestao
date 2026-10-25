import { describe, expect, it, vi } from "vitest";
import { CheckoutService } from "./checkout-service";
import type {
  CheckoutIdempotency,
  CheckoutOrder,
  CheckoutRepository,
  CheckoutResult,
  ProcessCheckoutInput,
} from "./repository";
import type { CheckoutCommand } from "./types";
import { HttpError } from "@/lib/api/http-errors";

/**
 * In-memory stand-in for the single checkout transaction: it checks the key, the open register
 * and the client the way the Firestore version does, and records the completed key with the order.
 */
class FakeCheckoutRepository implements CheckoutRepository {
  completed = new Map<string, { requestHash: string; order: CheckoutOrder }>();
  hasOpenRegister = true;
  clients = new Set(["client-1"]);
  failNext: unknown = null;

  processCheckoutMock = vi.fn(async (input: ProcessCheckoutInput): Promise<CheckoutResult> => {
    const key = `${input.idempotency.ownerId}:${input.idempotency.key}`;
    const previous = this.completed.get(key);
    if (previous) {
      if (previous.requestHash !== input.idempotency.requestHash) throw new HttpError(409, "conflito");
      return { replayed: true, order: previous.order };
    }
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    if (!this.hasOpenRegister) throw new HttpError(409, "Abra o caixa para finalizar a venda.");
    if (input.payLater && input.clientId && !this.clients.has(input.clientId)) {
      throw new HttpError(404, "Cliente não encontrado");
    }

    const order: CheckoutOrder = {
      id: `order-${this.completed.size + 1}`,
      subtotal: 100,
      discount: input.discount,
      totalAmount: input.expectedTotal,
      payments: input.payments,
      cashRegisterId: "register-1",
      createdAt: new Date(),
      items: [],
    };
    this.completed.set(key, { requestHash: input.idempotency.requestHash, order });
    return { replayed: false, order };
  });
  consumeDiscountAuthorizationMock = vi.fn(async (_userId: string) => false);

  async processCheckout(input: ProcessCheckoutInput) {
    return this.processCheckoutMock(input);
  }
  async findCompletedCheckout(idempotency: CheckoutIdempotency) {
    const previous = this.completed.get(`${idempotency.ownerId}:${idempotency.key}`);
    return previous && previous.requestHash === idempotency.requestHash ? previous.order : null;
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

  it.each([0, -2, 1.5])("rejects quantity %p before touching the database", async (quantity) => {
    const repo = new FakeCheckoutRepository();
    const service = new CheckoutService(repo);
    await expect(
      service.execute(baseCommand({ items: [{ productId: "p1", size: "", quantity }] }))
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(repo.processCheckoutMock).not.toHaveBeenCalled();
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
    repo.hasOpenRegister = false;
    const service = new CheckoutService(repo);
    await expect(service.execute(baseCommand())).rejects.toMatchObject({ statusCode: 409 });
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
    const service = new CheckoutService(new FakeCheckoutRepository());
    await expect(
      service.execute(baseCommand({ payLater: true, clientId: "missing-client", userRole: "ADMIN" }))
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("hands the client to the single checkout transaction, with no payments", async () => {
    const repo = new FakeCheckoutRepository();
    const service = new CheckoutService(repo);
    const result = await service.execute(baseCommand({ payLater: true, clientId: "client-1", userRole: "CASHIER" }));

    expect(result.status).toBe(201);
    expect(repo.processCheckoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "client-1", payLater: true, payments: [], change: 0 })
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
  it("returns the stored order on a retry of a completed sale, creating nothing new", async () => {
    const repo = new FakeCheckoutRepository();
    const service = new CheckoutService(repo);
    const command = baseCommand();

    const first = await service.execute(command);
    const second = await service.execute(command);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((second.body as CheckoutOrder).id).toBe((first.body as CheckoutOrder).id);
    expect(repo.completed.size).toBe(1);
  });

  it("recovers a sale whose response was lost even after its discount grant was used up", async () => {
    const repo = new FakeCheckoutRepository();
    repo.consumeDiscountAuthorizationMock.mockResolvedValueOnce(true).mockResolvedValue(false);
    const service = new CheckoutService(repo);
    const command = baseCommand({ discount: 50, payments: [{ method: "DINHEIRO", amount: 50 }] });

    const first = await service.execute(command);
    const retry = await service.execute(command);

    expect(retry.status).toBe(200);
    expect((retry.body as CheckoutOrder).id).toBe((first.body as CheckoutOrder).id);
    expect(repo.completed.size).toBe(1);
  });

  it("lets a failed sale be retried with the same key", async () => {
    const repo = new FakeCheckoutRepository();
    repo.failNext = new HttpError(409, "Estoque insuficiente");
    const service = new CheckoutService(repo);
    const command = baseCommand();

    await expect(service.execute(command)).rejects.toMatchObject({ statusCode: 409 });
    const retry = await service.execute(command);
    expect(retry.status).toBe(201);
  });

  it("rejects idempotency key reuse with a different payload as a conflict", async () => {
    const repo = new FakeCheckoutRepository();
    const service = new CheckoutService(repo);
    await service.execute(baseCommand({ idempotencyKey: "same-key" }));
    await expect(
      service.execute(baseCommand({ idempotencyKey: "same-key", discount: 5, payments: [{ method: "DINHEIRO", amount: 95 }] }))
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("lets an unexpected non-Error value propagate unchanged", async () => {
    const repo = new FakeCheckoutRepository();
    repo.failNext = "not an Error instance";
    const service = new CheckoutService(repo);
    await expect(service.execute(baseCommand({ idempotencyKey: "non-error-fail-key" }))).rejects.toBe(
      "not an Error instance"
    );
  });
});
