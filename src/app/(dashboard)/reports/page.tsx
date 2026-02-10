"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { BarChart3, Download, FileText } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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
  payments: {
    cash: number;
    debit: number;
    credit: number;
    pix: number;
    payLater: number;
    payLaterOutstanding?: number;
    payLaterReceived?: number;
  };
  totalStock: number;
  inventoryValue: number;
}

export default function ReportsPage() {
  const { toast } = useToast();
  const [report, setReport] = useState<StoreReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const fetchReports = async () => {
    setLoading(true);
    try {
      let url = "/api/reports";
      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      if (params.toString()) url += `?${params.toString()}`;

      const data = await apiGet(url);
      setReport(data || null);
    } catch (error) {
      toast({ title: "Erro ao carregar relatórios", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

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
      "Débito",
      "Crédito",
      "PIX",
      "Fiado",
      "Fiado (Recebido)",
      "Fiado (Em aberto)",
      "Estoque (Un)",
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
        ];

    const csv = [headers, row].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  };

  const exportPDF = () => {
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
      startY: (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY
        ? (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
        : 80,
      head: [
        [
          "Itens Vendidos",
          "Ticket Médio",
          "Dinheiro",
          "Débito",
          "Crédito",
          "PIX",
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
          formatCurrency(report?.payments?.debit || 0),
          formatCurrency(report?.payments?.credit || 0),
          formatCurrency(report?.payments?.pix || 0),
          formatCurrency(report?.payments?.payLater || 0),
          formatCurrency(report?.payments?.payLaterReceived || 0),
          formatCurrency(report?.payments?.payLaterOutstanding || 0),
        ],
      ],
    });

    doc.save(`relatorio-${new Date().toISOString().split("T")[0]}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Relatórios</h1>
          <p className="text-gray-500">Análise financeira</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-2" />
            CSV
          </Button>
          <Button variant="outline" onClick={exportPDF}>
            <FileText className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtrar por Período</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const today = new Date().toISOString().split("T")[0];
                setStartDate(today);
                setEndDate(today);
              }}
            >
              Hoje
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const today = new Date();
                const dayOfWeek = today.getDay();
                const monday = new Date(today);
                monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
                setStartDate(monday.toISOString().split("T")[0]);
                setEndDate(today.toISOString().split("T")[0]);
              }}
            >
              Esta Semana
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const today = new Date();
                const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
                setStartDate(firstDay.toISOString().split("T")[0]);
                setEndDate(today.toISOString().split("T")[0]);
              }}
            >
              Este Mês
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const today = new Date();
                const last30 = new Date(today);
                last30.setDate(today.getDate() - 30);
                setStartDate(last30.toISOString().split("T")[0]);
                setEndDate(today.toISOString().split("T")[0]);
              }}
            >
              Últimos 30 dias
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const today = new Date();
                const last90 = new Date(today);
                last90.setDate(today.getDate() - 90);
                setStartDate(last90.toISOString().split("T")[0]);
                setEndDate(today.toISOString().split("T")[0]);
              }}
            >
              Últimos 90 dias
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStartDate("");
                setEndDate("");
              }}
            >
              Todo Período
            </Button>
          </div>
          <div className="flex gap-4 items-end">
            <div className="space-y-2">
              <Label>Data Inicial</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Data Final</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <Button onClick={handleFilter}>Filtrar</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Receita</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.revenue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Custo Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatCurrency(totals.cost)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Lucro Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(totals.profit)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Margem Média</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatPercentage(totals.revenue > 0 ? totals.profit / totals.revenue : 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Receita Bruta</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.grossRevenue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Descontos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{formatCurrency(totals.discounts)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pedidos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{report?.ordersCount || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Ticket Médio</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(report?.averageTicket || 0)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Relatório
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-4">Carregando...</p>
          ) : !report ? (
            <p className="text-center py-4 text-gray-500">
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
                  <TableHead className="text-right">Estoque (Un)</TableHead>
                  <TableHead className="text-right">Valor Estoque</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-right">{formatCurrency(report.grossRevenue)}</TableCell>
                  <TableCell className="text-right text-red-600">{formatCurrency(report.discounts)}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(report.revenue)}
                  </TableCell>
                  <TableCell className="text-right text-red-600">
                    {formatCurrency(report.cost)}
                  </TableCell>
                  <TableCell className="text-right text-green-600 font-bold">
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
          <CardTitle>Pagamentos</CardTitle>
        </CardHeader>
        <CardContent>
          {!report ? (
            <p className="text-gray-500 text-sm">Nenhum dado</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Dinheiro</TableHead>
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
    </div>
  );
}
