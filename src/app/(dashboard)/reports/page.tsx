"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency, formatPercentage } from "@/lib/utils";
import { apiGet } from "@/lib/api-client";
import { AlertTriangle, Download, FileText, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { TotalsStrip } from "@/components/etiqueta/totals-strip";
import { toStoreISODate, todayISO } from "@/lib/dates";
import { loadPdf } from "@/lib/pdf";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RestockReport } from "@/components/reports/restock-report";
import { StagnantStockReport } from "@/components/reports/stagnant-stock-report";
import { FiadoCollectionReport } from "@/components/reports/fiado-collection-report";
import { RegisterDifferencesReport } from "@/components/reports/register-differences-report";
import { SalesInsightsReport } from "@/components/reports/sales-insights-report";
import { ExchangesReport } from "@/components/reports/exchanges-report";
import type { jsPDF as JsPdfDoc } from "jspdf";

interface StoreReport {
  grossRevenue: number;
  discounts: number;
  revenue: number;
  cost: number;
  profit: number;
  profitMargin: number;
  ordersCount: number;
  itemsSold: number;
  averageTicket: number;
  stockPurchasesCost?: number;
  payments: {
    cash: number;
    exchangeDifferenceIn?: number;
    debit: number;
    credit: number;
    pix: number;
    payLater: number;
    payLaterOutstanding?: number;
    payLaterReceived?: number;
  };
  totalStock: number;
  inventoryValue: number;
  period?: {
    start: string;
    end: string;
    days: number;
  };
  dre?: {
    grossRevenue: number;
    discounts: number;
    netRevenue: number;
    cogs: number;
    grossProfit: number;
    grossMargin: number;
    operatingExpenses: number;
    netProfit: number;
    netMargin: number;
  };
  monthlyDre?: Array<{
    month: string;
    source: "closure" | "live";
    revenue: number;
    cogs: number;
    grossProfit: number;
    expenses: number;
    netResult: number;
  }>;
  cashFlow?: {
    inflowsActual: number;
    outflowsActual: number;
    netCashFlowActual: number;
    projectedInflows30: number;
    projectedOutflows30: number;
    projectedNetCashFlow30: number;
  };
  sales?: {
    ordersCount: number;
    itemsSold: number;
    averageTicket: number;
    bestSalesDay?: { day: string; revenue: number; orders: number } | null;
    payLaterOutstanding: number;
    payLaterReceived: number;
  };
  fiadoAging?: {
    asOf: string;
    totalOutstanding: number;
    buckets: {
      current30: number;
      days31to60: number;
      days61to90: number;
      days90plus: number;
    };
  };
  inventory?: {
    totalStock: number;
    inventoryValueCost: number;
    inventoryValueSale: number;
    stockCoverageDays: number;
    turnover: number;
    lowStockCount: number;
    outOfStockCount: number;
    deadStockCount: number;
  };
  profitability?: {
    topProfitProducts: Array<{
      productId: string;
      productName: string;
      sku: string;
      qtySold: number;
      revenue: number;
      cost: number;
      profit: number;
      margin: number;
    }>;
    lowMarginProducts: Array<{
      productId: string;
      productName: string;
      sku: string;
      qtySold: number;
      revenue: number;
      cost: number;
      profit: number;
      margin: number;
    }>;
  };
  goals?: {
    targetRevenue: number;
    targetAverageTicket: number;
    targetMargin: number;
    achievementRevenue: number;
    achievementAverageTicket: number;
    achievementMargin: number;
  };
  promotions?: {
    totalDiscounts: number;
    discountRate: number;
    ordersWithDiscount: number;
    discountedOrdersRate: number;
    avgDiscountPerDiscountedOrder: number;
    discountedRevenue: number;
  };
  alerts?: {
    dre: string[];
    cashFlow: string[];
    sales: string[];
    inventory: string[];
    profitability: string[];
    goals: string[];
    promotions: string[];
  };
  insights?: {
    dre: string;
    cashFlow: string;
    sales: string;
    inventory: string;
    profitability: string;
    goals: string;
    promotions: string;
  };
  debug?: {
    monthlySources: Array<{
      month: string;
      source: "closure" | "live_movements" | "legacy_collections";
      closureExists: boolean;
      movementCount: number;
      legacyDiagnostics: {
        ordersCount: number;
        paidBillsCount: number;
        stockPurchasesCount: number;
        exchangesCount: number;
      };
      totals: {
        revenue: number;
        cogs: number;
        expenses: number;
        netResult: number;
      };
    }>;
  };
}

export default function ReportsPage() {
  const { toast } = useToast();
  const [report, setReport] = useState<StoreReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tab, setTab] = useState<"resultado" | "vendas" | "trocas" | "reposicao" | "parado" | "cobranca" | "caixa">("resultado");

  const fetchReports = async (forceRefresh: boolean = false) => {
    setLoading(true);
    try {
      let url = "/api/reports";
      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      if (forceRefresh) params.append("forceRefresh", "1");
      params.append("debug", "1");
      if (params.toString()) url += `?${params.toString()}`;

      const data = await apiGet(url);
      setReport(data || null);
    } catch {
      toast({ title: "Erro ao carregar relatórios", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
    // Intentionally run once on mount with the default (empty) date range — changing the
    // date fields is applied explicitly via the "Filtrar" button (handleFilter), which reads
    // the current startDate/endDate itself. Including fetchReports here would make every
    // keystroke in the date fields trigger a refetch instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any sale or change already refreshes the server's copy, so applying a period never needs to
  // force a recalculation (that only made the button slow).
  const handleFilter = () => {
    fetchReports();
  };

  const totals = {
    grossRevenue: report?.grossRevenue || 0,
    discounts: report?.discounts || 0,
    revenue: report?.revenue || 0,
    cost: report?.cost || 0,
    profit: report?.profit || 0,
    inventoryValue: report?.inventoryValue || 0,
    stockPurchasesCost: report?.stockPurchasesCost || 0,
  };

  const exportCSV = () => {
    const headers = [
      "Receita Bruta",
      "Descontos",
      "Receita",
      "Custo",
      "Lucro",
      "Margem",
      "Pedidos",
      "Itens Vendidos",
      "Ticket Médio",
      "Dinheiro",
      "Diferença de Troca (Entrada)",
      "Débito",
      "Crédito",
      "Pix",
      "Fiado",
      "Fiado (Recebido)",
      "Fiado (Em aberto)",
      "Estoque (unidades)",
      "Valor Estoque",
    ];
    const row = report
      ? [
          report.grossRevenue.toFixed(2),
          report.discounts.toFixed(2),
          report.revenue.toFixed(2),
          report.cost.toFixed(2),
          report.profit.toFixed(2),
          (report.profitMargin * 100).toFixed(1) + "%",
          report.ordersCount.toString(),
          report.itemsSold.toString(),
          report.averageTicket.toFixed(2),
          report.payments.cash.toFixed(2),
          (report.payments.exchangeDifferenceIn ?? 0).toFixed(2),
          report.payments.debit.toFixed(2),
          report.payments.credit.toFixed(2),
          report.payments.pix.toFixed(2),
          report.payments.payLater.toFixed(2),
          (report.payments.payLaterReceived ?? 0).toFixed(2),
          (report.payments.payLaterOutstanding ?? 0).toFixed(2),
          report.totalStock.toString(),
          report.inventoryValue.toFixed(2),
        ]
      : [
          "0",
          "0",
          "0",
          "0",
          "0",
          "0%",
          "0",
          "0",
          "0",
          "0",
          "0",
          "0",
          "0",
          "0",
          "0",
          "0",
          "0",
          "0",
          "0",
        ];

    const csv = [headers, row].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-${todayISO()}.csv`;
    a.click();
  };

  const exportPDF = async () => {
    const { jsPDF, autoTable } = await loadPdf();
    const doc = new jsPDF();

    doc.setFontSize(20);
    doc.text("Relatório Financeiro", 14, 22);

    doc.setFontSize(10);
    doc.text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, 14, 30);
    if (startDate && endDate) {
      doc.text(`Período: ${startDate} até ${endDate}`, 14, 36);
    }

    autoTable(doc, {
      startY: 45,
      head: [
        [
          "Receita Bruta",
          "Descontos",
          "Receita",
          "Custo",
          "Lucro",
          "Margem",
          "Pedidos",
        ],
      ],
      body: [
        [
          formatCurrency(totals.grossRevenue),
          formatCurrency(totals.discounts),
          formatCurrency(totals.revenue),
          formatCurrency(totals.cost),
          formatCurrency(totals.profit),
          formatPercentage(totals.revenue > 0 ? totals.profit / totals.revenue : 0),
          report?.ordersCount?.toString() || "0",
        ],
      ],
    });

    autoTable(doc, {
      startY: (doc as JsPdfDoc & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY
        ? (doc as JsPdfDoc & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
        : 80,
      head: [
        [
          "Itens Vendidos",
          "Ticket Médio",
          "Dinheiro",
          "Dif. Troca",
          "Débito",
          "Crédito",
          "Pix",
          "Fiado",
          "Fiado (Recebido)",
          "Fiado (Em aberto)",
        ],
      ],
      body: [
        [
          report?.itemsSold?.toString() || "0",
          formatCurrency(report?.averageTicket || 0),
          formatCurrency(report?.payments?.cash || 0),
          formatCurrency(report?.payments?.exchangeDifferenceIn || 0),
          formatCurrency(report?.payments?.debit || 0),
          formatCurrency(report?.payments?.credit || 0),
          formatCurrency(report?.payments?.pix || 0),
          formatCurrency(report?.payments?.payLater || 0),
          formatCurrency(report?.payments?.payLaterReceived || 0),
          formatCurrency(report?.payments?.payLaterOutstanding || 0),
        ],
      ],
    });

    doc.save(`relatorio-${todayISO()}.pdf`);
  };

  const setPreset = (preset: "today" | "this_week" | "this_month" | "last_30" | "last_90" | "all") => {
    const today = new Date();
    const iso = toStoreISODate;
    if (preset === "all") {
      setStartDate("");
      setEndDate("");
      return;
    }
    const start = new Date(today);
    if (preset === "this_week") {
      const dayOfWeek = today.getDay();
      start.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    } else if (preset === "this_month") {
      start.setTime(new Date(today.getFullYear(), today.getMonth(), 1).getTime());
    } else if (preset === "last_30") {
      start.setDate(today.getDate() - 29);
    } else if (preset === "last_90") {
      start.setDate(today.getDate() - 89);
    }
    setStartDate(iso(start));
    setEndDate(iso(today));
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Relatórios"
        meta={<span>Resultado, vendas, trocas, estoque, cobrança e caixa</span>}
        actions={
          tab !== "resultado" ? null : <>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-4 w-4" aria-hidden="true" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportPDF}>
              <FileText className="h-4 w-4" aria-hidden="true" />
              PDF
            </Button>
          </>
        }
        className="mb-0 md:mb-0"
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
      <TabsList className="-mx-3 flex w-[calc(100%+1.5rem)] scroll-row overflow-x-auto px-3 sm:mx-0 sm:w-full sm:px-0">
        <TabsTrigger value="resultado">Resultado</TabsTrigger>
        <TabsTrigger value="vendas">Vendas</TabsTrigger>
        <TabsTrigger value="trocas">Trocas</TabsTrigger>
        <TabsTrigger value="reposicao">Reposição</TabsTrigger>
        <TabsTrigger value="parado">Estoque parado</TabsTrigger>
        <TabsTrigger value="cobranca">Cobrança de fiado</TabsTrigger>
        <TabsTrigger value="caixa">Diferenças de caixa</TabsTrigger>
      </TabsList>

      <TabsContent value="vendas"><SalesInsightsReport /></TabsContent>
      <TabsContent value="trocas"><ExchangesReport /></TabsContent>
      <TabsContent value="reposicao"><RestockReport /></TabsContent>
      <TabsContent value="parado"><StagnantStockReport /></TabsContent>
      <TabsContent value="cobranca"><FiadoCollectionReport /></TabsContent>
      <TabsContent value="caixa"><RegisterDifferencesReport /></TabsContent>

      <TabsContent value="resultado" className="space-y-4 md:space-y-6">
      <div className="space-y-3">
        <div className="-mx-3 flex gap-1.5 scroll-row overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Períodos rápidos">
          {([
            ["today", "Hoje"],
            ["this_week", "Esta semana"],
            ["this_month", "Este mês"],
            ["last_30", "Últimos 30 dias"],
            ["last_90", "Últimos 90 dias"],
            ["all", "Todo o período"],
          ] as const).map(([preset, label]) => (
            <button
              key={preset}
              type="button"
              onClick={() => setPreset(preset)}
              className="inline-flex h-9 flex-shrink-0 items-center border border-rule-strong bg-paper px-3 text-sm font-semibold text-ink transition-colors hover:border-ink"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="rep-start" className="text-xs">De</Label>
            <Input id="rep-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 w-[160px]" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rep-end" className="text-xs">Até</Label>
            <Input id="rep-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 w-[160px]" />
          </div>
          <Button size="sm" onClick={handleFilter} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Aplicando…
              </>
            ) : (
              "Aplicar período"
            )}
          </Button>
        </div>
      </div>

      <TotalsStrip
        items={[
          { label: "Receita", value: formatCurrency(totals.revenue) },
          { label: "Lucro", value: formatCurrency(totals.profit), tone: "positive" },
          { label: "Margem média", value: formatPercentage(totals.revenue > 0 ? totals.profit / totals.revenue : 0) },
          { label: "Compras", value: formatCurrency(totals.stockPurchasesCost) },
          { label: "Receita bruta", value: formatCurrency(totals.grossRevenue) },
          { label: "Descontos", value: formatCurrency(totals.discounts), tone: "debt" },
          { label: "Pedidos", value: report?.ordersCount || 0 },
          { label: "Ticket médio", value: formatCurrency(report?.averageTicket || 0) },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>Resumo em tabela</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-16 animate-pulse bg-sub" aria-hidden="true" />
          ) : !report ? (
            <p className="text-center py-4 text-ink-3">
              Nenhum dado encontrado
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Receita Bruta</TableHead>
                  <TableHead className="text-right">Descontos</TableHead>
                  <TableHead className="text-right">Receita</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead className="text-right">Lucro</TableHead>
                  <TableHead className="text-right">Margem</TableHead>
                  <TableHead className="text-right">Pedidos</TableHead>
                  <TableHead className="text-right">Itens</TableHead>
                  <TableHead className="text-right">Estoque (unidades)</TableHead>
                  <TableHead className="text-right">Valor Estoque</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-right">{formatCurrency(report.grossRevenue)}</TableCell>
                  <TableCell className="text-right text-vermelho">{formatCurrency(report.discounts)}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(report.revenue)}
                  </TableCell>
                  <TableCell className="text-right text-vermelho">
                    {formatCurrency(report.cost)}
                  </TableCell>
                  <TableCell className="text-right text-verde font-bold">
                    {formatCurrency(report.profit)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatPercentage(report.profitMargin)}
                  </TableCell>
                  <TableCell className="text-right">{report.ordersCount}</TableCell>
                  <TableCell className="text-right">{report.itemsSold}</TableCell>
                  <TableCell className="text-right">{report.totalStock}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(report.inventoryValue)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Formas de pagamento</CardTitle>
        </CardHeader>
        <CardContent>
          {!report ? (
            <p className="text-ink-3 text-sm">Nenhum dado</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Dinheiro</TableHead>
                  <TableHead className="text-right">Diferença Troca</TableHead>
                  <TableHead className="text-right">Débito</TableHead>
                  <TableHead className="text-right">Crédito</TableHead>
                  <TableHead className="text-right">PIX</TableHead>
                  <TableHead className="text-right">Fiado</TableHead>
                  <TableHead className="text-right">Fiado (Recebido)</TableHead>
                  <TableHead className="text-right">Fiado (Em aberto)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-right">{formatCurrency(report.payments.cash)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.payments.exchangeDifferenceIn || 0)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.payments.debit)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.payments.credit)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.payments.pix)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.payments.payLater)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.payments.payLaterReceived || 0)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.payments.payLaterOutstanding || 0)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resultado do período</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableBody>
              <TableRow><TableCell>Receita bruta</TableCell><TableCell className="text-right">{formatCurrency(report?.dre?.grossRevenue ?? 0)}</TableCell></TableRow>
              <TableRow><TableCell>Descontos</TableCell><TableCell className="text-right text-vermelho">{formatCurrency(report?.dre?.discounts ?? 0)}</TableCell></TableRow>
              <TableRow><TableCell>Receita líquida</TableCell><TableCell className="text-right">{formatCurrency(report?.dre?.netRevenue ?? 0)}</TableCell></TableRow>
              <TableRow><TableCell>Custo das mercadorias vendidas</TableCell><TableCell className="text-right text-vermelho">{formatCurrency(report?.dre?.cogs ?? 0)}</TableCell></TableRow>
              <TableRow><TableCell>Lucro bruto</TableCell><TableCell className="text-right font-semibold text-verde">{formatCurrency(report?.dre?.grossProfit ?? 0)}</TableCell></TableRow>
              <TableRow><TableCell>Despesas operacionais</TableCell><TableCell className="text-right text-vermelho">{formatCurrency(report?.dre?.operatingExpenses ?? 0)}</TableCell></TableRow>
              <TableRow className="border-t-2 border-ink font-bold hover:bg-transparent"><TableCell>Lucro líquido</TableCell><TableCell className="text-right font-bold">{formatCurrency(report?.dre?.netProfit ?? 0)}</TableCell></TableRow>
            </TableBody>
          </Table>
          <p className="text-sm text-ink-2">{report?.insights?.dre}</p>
          {(report?.alerts?.dre?.length || 0) > 0 && <p className="text-sm text-vermelho mt-2 flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />{report?.alerts?.dre.join(" | ")}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fluxo de caixa · real e projetado</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-8 md:grid-cols-2">
          <div className="text-sm">
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Entradas (real)</span><span className="text-right font-semibold tabular-nums">{formatCurrency(report?.cashFlow?.inflowsActual ?? 0)}</span></div>
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Entradas por diferença de troca</span><span className="text-right font-semibold tabular-nums">{formatCurrency(report?.payments?.exchangeDifferenceIn ?? 0)}</span></div>
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Saídas (real)</span><span className="text-right font-semibold tabular-nums">{formatCurrency(report?.cashFlow?.outflowsActual ?? 0)}</span></div>
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Fluxo líquido (real)</span><span className="text-right font-semibold tabular-nums">{formatCurrency(report?.cashFlow?.netCashFlowActual ?? 0)}</span></div>
          </div>
          <div className="text-sm">
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Entradas projetadas (30 dias)</span><span className="text-right font-semibold tabular-nums">{formatCurrency(report?.cashFlow?.projectedInflows30 ?? 0)}</span></div>
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Saídas projetadas (30 dias)</span><span className="text-right font-semibold tabular-nums">{formatCurrency(report?.cashFlow?.projectedOutflows30 ?? 0)}</span></div>
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Fluxo líquido projetado (30 dias)</span><span className="text-right font-semibold tabular-nums">{formatCurrency(report?.cashFlow?.projectedNetCashFlow30 ?? 0)}</span></div>
          </div>
          <p className="text-sm text-ink-2 md:col-span-2">{report?.insights?.cashFlow}</p>
          {(report?.alerts?.cashFlow?.length || 0) > 0 && <p className="text-sm text-vermelho md:col-span-2 mt-2 flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />{report?.alerts?.cashFlow.join(" | ")}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fiado em aberto por idade</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-8 text-sm md:grid-cols-2">
          <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Em aberto total</span><span className="text-right font-semibold tabular-nums">{formatCurrency(report?.fiadoAging?.totalOutstanding ?? 0)}</span></div>
          <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Até 30 dias</span><span className="text-right font-semibold tabular-nums">{formatCurrency(report?.fiadoAging?.buckets.current30 ?? 0)}</span></div>
          <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">31 a 60 dias</span><span className="text-right font-semibold tabular-nums">{formatCurrency(report?.fiadoAging?.buckets.days31to60 ?? 0)}</span></div>
          <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">61 a 90 dias</span><span className="text-right font-semibold tabular-nums">{formatCurrency(report?.fiadoAging?.buckets.days61to90 ?? 0)}</span></div>
          <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">90+ dias</span><span className="text-right font-semibold tabular-nums">{formatCurrency(report?.fiadoAging?.buckets.days90plus ?? 0)}</span></div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Estoque e giro</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Cobertura de estoque (dias)</span><span className="text-right font-semibold tabular-nums">{(report?.inventory?.stockCoverageDays ?? 0).toFixed(1)}</span></div>
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Giro</span><span className="text-right font-semibold tabular-nums">{(report?.inventory?.turnover ?? 0).toFixed(2)}x</span></div>
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Produtos sem estoque</span><span className="text-right font-semibold tabular-nums">{report?.inventory?.outOfStockCount ?? 0}</span></div>
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Produtos com baixo estoque</span><span className="text-right font-semibold tabular-nums">{report?.inventory?.lowStockCount ?? 0}</span></div>
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Produtos sem giro</span><span className="text-right font-semibold tabular-nums">{report?.inventory?.deadStockCount ?? 0}</span></div>
            <p className="mt-2 text-ink-2">{report?.insights?.inventory}</p>
            {(report?.alerts?.inventory?.length || 0) > 0 && <p className="text-vermelho mt-2 flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />{report?.alerts?.inventory.join(" | ")}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Metas</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Meta Receita</span><span className="text-right font-semibold tabular-nums">{formatCurrency(report?.goals?.targetRevenue ?? 0)}</span></div>
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Atingimento Receita</span><span className="text-right font-semibold tabular-nums">{formatPercentage(report?.goals?.achievementRevenue ?? 0)}</span></div>
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Meta Ticket Médio</span><span className="text-right font-semibold tabular-nums">{formatCurrency(report?.goals?.targetAverageTicket ?? 0)}</span></div>
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Atingimento Ticket</span><span className="text-right font-semibold tabular-nums">{formatPercentage(report?.goals?.achievementAverageTicket ?? 0)}</span></div>
            <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Atingimento Margem</span><span className="text-right font-semibold tabular-nums">{formatPercentage(report?.goals?.achievementMargin ?? 0)}</span></div>
            <p className="mt-2 text-ink-2">{report?.insights?.goals}</p>
            {(report?.alerts?.goals?.length || 0) > 0 && <p className="text-vermelho mt-2 flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />{report?.alerts?.goals.join(" | ")}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Produtos que mais lucram · top 10</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>Código do produto</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
                <TableHead className="text-right">Receita</TableHead>
                <TableHead className="text-right">Lucro</TableHead>
                <TableHead className="text-right">Margem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(report?.profitability?.topProfitProducts || []).map((p) => (
                <TableRow key={p.productId}>
                  <TableCell>{p.productName}</TableCell>
                  <TableCell>{p.sku}</TableCell>
                  <TableCell className="text-right">{p.qtySold}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.revenue)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.profit)}</TableCell>
                  <TableCell className="text-right">{formatPercentage(p.margin)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-sm text-ink-2 mt-3">{report?.insights?.profitability}</p>
          {(report?.alerts?.profitability?.length || 0) > 0 && <p className="text-sm text-vermelho mt-2 flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />{report?.alerts?.profitability.join(" | ")}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Promoções e descontos</CardTitle></CardHeader>
        <CardContent className="text-sm">
          <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Descontos totais</span><span className="text-right font-semibold tabular-nums">{formatCurrency(report?.promotions?.totalDiscounts ?? 0)}</span></div>
          <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Taxa de desconto</span><span className="text-right font-semibold tabular-nums">{formatPercentage(report?.promotions?.discountRate ?? 0)}</span></div>
          <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Pedidos com desconto</span><span className="text-right font-semibold tabular-nums">{report?.promotions?.ordersWithDiscount ?? 0}</span></div>
          <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">% pedidos com desconto</span><span className="text-right font-semibold tabular-nums">{formatPercentage(report?.promotions?.discountedOrdersRate ?? 0)}</span></div>
          <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0"><span className="text-ink-2">Desconto médio por pedido com desconto</span><span className="text-right font-semibold tabular-nums">{formatCurrency(report?.promotions?.avgDiscountPerDiscountedOrder ?? 0)}</span></div>
          <p className="mt-2 text-ink-2">{report?.insights?.promotions}</p>
          {(report?.alerts?.promotions?.length || 0) > 0 && <p className="text-vermelho mt-2 flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />{report?.alerts?.promotions.join(" | ")}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resultado mês a mês · fechado e aberto</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                <TableHead>Fonte</TableHead>
                <TableHead className="text-right">Receita</TableHead>
                <TableHead className="text-right">CMV</TableHead>
                <TableHead className="text-right">Lucro Bruto</TableHead>
                <TableHead className="text-right">Despesas</TableHead>
                <TableHead className="text-right">Resultado Líquido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(report?.monthlyDre || []).map((row) => (
                <TableRow key={row.month}>
                  <TableCell>{row.month}</TableCell>
                  <TableCell>{row.source === "closure" ? "Fechado" : "Aberto"}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.revenue)}</TableCell>
                  <TableCell className="text-right text-vermelho">{formatCurrency(row.cogs)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.grossProfit)}</TableCell>
                  <TableCell className="text-right text-vermelho">{formatCurrency(row.expenses)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatCurrency(row.netResult)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conferência das fontes de dados</CardTitle>
          <CardDescription>Para conferir de onde vem cada número do mês.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                <TableHead>Fonte</TableHead>
                <TableHead className="text-right">Movimentos</TableHead>
                <TableHead className="text-right">Pedidos (legado)</TableHead>
                <TableHead className="text-right">Contas pagas (legado)</TableHead>
                <TableHead className="text-right">Compras (legado)</TableHead>
                <TableHead className="text-right">Trocas (legado)</TableHead>
                <TableHead className="text-right">Receita</TableHead>
                <TableHead className="text-right">CMV</TableHead>
                <TableHead className="text-right">Despesas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(report?.debug?.monthlySources || []).map((row) => (
                <TableRow key={`debug-${row.month}`}>
                  <TableCell>{row.month}</TableCell>
                  <TableCell>{row.source}</TableCell>
                  <TableCell className="text-right">{row.movementCount}</TableCell>
                  <TableCell className="text-right">{row.legacyDiagnostics.ordersCount}</TableCell>
                  <TableCell className="text-right">{row.legacyDiagnostics.paidBillsCount}</TableCell>
                  <TableCell className="text-right">{row.legacyDiagnostics.stockPurchasesCount}</TableCell>
                  <TableCell className="text-right">{row.legacyDiagnostics.exchangesCount}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.totals.revenue)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.totals.cogs)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.totals.expenses)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      </TabsContent>
      </Tabs>

    </div>
  );
}
