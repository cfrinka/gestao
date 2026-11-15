import { describe, expect, it } from "vitest";
import {
  salePaymentLabel,
  salePieceCount,
  saleStatus,
  summarizeSales,
  type SummarizableSale,
} from "./sales-summary";

const sale = (overrides: Partial<SummarizableSale> = {}): SummarizableSale => ({
  createdAt: "2026-11-10T15:00:00.000Z",
  totalAmount: 100,
  items: [{ quantity: 1 }],
  payments: [{ method: "PIX", amount: 100 }],
  ...overrides,
});

describe("summarizeSales", () => {
  it("returns zeros for an empty list", () => {
    expect(summarizeSales([])).toEqual({
      saleCount: 0,
      cancelledCount: 0,
      totalSold: 0,
      totalReceived: 0,
      fiadoOutstanding: 0,
      averageTicket: 0,
    });
  });

  it("leaves cancelled sales out of every total but counts them separately", () => {
    const summary = summarizeSales([sale({ totalAmount: 80 }), sale({ totalAmount: 500, isCancelled: true })]);
    expect(summary).toMatchObject({ saleCount: 1, cancelledCount: 1, totalSold: 80, totalReceived: 80, averageTicket: 80 });
  });

  it("splits fiado between received and outstanding using amountPaid/remainingAmount", () => {
    const summary = summarizeSales([
      sale({ totalAmount: 200 }),
      sale({ totalAmount: 150, isPaidLater: true, amountPaid: 50, remainingAmount: 100, payments: [] }),
    ]);
    expect(summary.totalSold).toBe(350);
    expect(summary.totalReceived).toBe(250);
    expect(summary.fiadoOutstanding).toBe(100);
    expect(summary.averageTicket).toBe(175);
  });

  it("falls back to paidAt for legacy fiado sales without amountPaid/remainingAmount", () => {
    const paid = summarizeSales([sale({ totalAmount: 90, isPaidLater: true, paidAt: "2026-11-11T10:00:00Z" })]);
    expect(paid).toMatchObject({ totalReceived: 90, fiadoOutstanding: 0 });

    const open = summarizeSales([sale({ totalAmount: 90, isPaidLater: true })]);
    expect(open).toMatchObject({ totalReceived: 0, fiadoOutstanding: 90 });
  });

  it("treats a non-numeric totalAmount as zero", () => {
    const summary = summarizeSales([sale({ totalAmount: Number.NaN }), sale({ totalAmount: 40 })]);
    expect(summary.totalSold).toBe(40);
  });
});

describe("salePaymentLabel", () => {
  it("joins distinct methods in Portuguese", () => {
    expect(
      salePaymentLabel(
        sale({
          payments: [
            { method: "DINHEIRO", amount: 20 },
            { method: "CREDITO", amount: 50 },
            { method: "DINHEIRO", amount: 30 },
          ],
        })
      )
    ).toBe("Dinheiro + Crédito");
  });

  it("labels fiado and missing payments", () => {
    expect(salePaymentLabel(sale({ isPaidLater: true }))).toBe("Fiado");
    expect(salePaymentLabel(sale({ payments: [] }))).toBe("—");
    expect(salePaymentLabel(sale({ payments: undefined }))).toBe("—");
  });
});

describe("saleStatus", () => {
  it("maps each kind of sale", () => {
    expect(saleStatus(sale())).toBe("Paga");
    expect(saleStatus(sale({ isPaidLater: true }))).toBe("Fiado pendente");
    expect(saleStatus(sale({ isPaidLater: true, paidAt: "2026-11-12T00:00:00Z" }))).toBe("Fiado quitado");
    expect(saleStatus(sale({ isCancelled: true, isPaidLater: true }))).toBe("Cancelada");
  });
});

describe("salePieceCount", () => {
  it("sums quantities rather than counting lines", () => {
    expect(salePieceCount(sale({ items: [{ quantity: 2 }, { quantity: 3 }] }))).toBe(5);
    expect(salePieceCount(sale({ items: undefined }))).toBe(0);
  });
});
