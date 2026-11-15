/**
 * Regras de leitura de uma lista de vendas usadas tanto na tela /sales quanto no
 * relatório em Excel — ficam num lugar só para que os totais da planilha sejam
 * exatamente os mesmos que aparecem na tela.
 */

export type SalePaymentMethod = "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX";

export interface SummarizableSale {
  createdAt: string;
  totalAmount: number;
  items?: { quantity?: number }[];
  payments?: { method: SalePaymentMethod; amount: number }[];
  isPaidLater?: boolean;
  amountPaid?: number;
  remainingAmount?: number;
  paidAt?: string;
  isCancelled?: boolean;
  /**
   * Não é uma venda: dinheiro recebido no período por uma venda fiado antiga (a lista de
   * /api/orders traz essas entradas junto com as vendas; ver fiado-payment.ts).
   */
  entryType?: "fiado_payment";
}

export interface SalesSummary {
  /** Vendas não canceladas (recebimentos de fiado não contam). */
  saleCount: number;
  cancelledCount: number;
  totalSold: number;
  /**
   * Dinheiro que entrou no período: vendas pagas na hora mais os recebimentos de fiado.
   * Uma venda fiado só entra por meio dos seus recebimentos, datados de quando o dinheiro
   * chegou; nunca pelo amountPaid acumulado do pedido, que contaria o mesmo valor duas vezes.
   */
  totalReceived: number;
  /** Parte de totalReceived que veio de recebimentos de fiado. */
  fiadoReceived: number;
  fiadoReceiptCount: number;
  fiadoOutstanding: number;
  averageTicket: number;
}

const amountOf = (sale: SummarizableSale) =>
  typeof sale.totalAmount === "number" && Number.isFinite(sale.totalAmount) ? sale.totalAmount : 0;

export const isFiadoReceipt = (sale: SummarizableSale) => sale.entryType === "fiado_payment";

export function summarizeSales(sales: SummarizableSale[]): SalesSummary {
  let saleCount = 0;
  let cancelledCount = 0;
  let totalSold = 0;
  let totalReceived = 0;
  let fiadoReceived = 0;
  let fiadoReceiptCount = 0;
  let fiadoOutstanding = 0;

  for (const sale of sales) {
    if (isFiadoReceipt(sale)) {
      if (sale.isCancelled) continue;
      const amount = amountOf(sale);
      fiadoReceived += amount;
      fiadoReceiptCount += 1;
      totalReceived += amount;
      continue;
    }

    if (sale.isCancelled) {
      cancelledCount += 1;
      continue;
    }
    const total = amountOf(sale);
    saleCount += 1;
    totalSold += total;

    if (!sale.isPaidLater) {
      totalReceived += total;
      continue;
    }

    if (typeof sale.remainingAmount === "number") fiadoOutstanding += sale.remainingAmount;
    else if (!sale.paidAt) fiadoOutstanding += total;
  }

  return {
    saleCount,
    cancelledCount,
    totalSold,
    totalReceived,
    fiadoReceived,
    fiadoReceiptCount,
    fiadoOutstanding,
    averageTicket: saleCount > 0 ? totalSold / saleCount : 0,
  };
}

export const PAYMENT_METHOD_LABEL: Record<SalePaymentMethod, string> = {
  DINHEIRO: "Dinheiro",
  DEBITO: "Débito",
  CREDITO: "Crédito",
  PIX: "PIX",
};

/** "Dinheiro + PIX", "Fiado" ou "—" quando a venda não tem pagamento registrado. */
export function salePaymentLabel(sale: SummarizableSale): string {
  if (sale.isPaidLater) return "Fiado";
  const methods = Array.from(new Set((sale.payments || []).map((p) => p.method)));
  if (methods.length === 0) return "—";
  return methods.map((method) => PAYMENT_METHOD_LABEL[method] || method).join(" + ");
}

export type SaleStatus = "Paga" | "Fiado pendente" | "Fiado quitado" | "Cancelada";

export function saleStatus(sale: SummarizableSale): SaleStatus {
  if (sale.isCancelled) return "Cancelada";
  if (!sale.isPaidLater) return "Paga";
  return sale.paidAt ? "Fiado quitado" : "Fiado pendente";
}

/** Número de peças vendidas (soma das quantidades), não de linhas do pedido. */
export function salePieceCount(sale: SummarizableSale): number {
  return (sale.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}
