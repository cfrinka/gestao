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

interface OwnerReport {
  owner: {
    id: string;
    name: string;
  };
  revenue: number;
  cost: number;
  profit: number;
  profitMargin: number;
  totalStock: number;
  inventoryValue: number;
}

export default function ReportsPage() {
  const { toast } = useToast();
  const [reports, setReports] = useState<OwnerReport[]>([]);
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
      setReports(Array.isArray(data) ? data : []);
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

  const totals = reports.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue,
      cost: acc.cost + r.cost,
      profit: acc.profit + r.profit,
      inventoryValue: acc.inventoryValue + r.inventoryValue,
    }),
    { revenue: 0, cost: 0, profit: 0, inventoryValue: 0 }
  );

  const exportCSV = () => {
    const headers = [
      "Proprietário",
      "Receita",
      "Custo",
      "Lucro",
      "Margem",
      "Estoque (Un)",
      "Valor Estoque",
    ];
    const rows = reports.map((r) => [
      r.owner.name,
      r.revenue.toFixed(2),
      r.cost.toFixed(2),
      r.profit.toFixed(2),
      (r.profitMargin * 100).toFixed(1) + "%",
      r.totalStock.toString(),
      r.inventoryValue.toFixed(2),
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
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
          "Proprietário",
          "Receita",
          "Custo",
          "Lucro",
          "Margem",
          "Estoque",
          "Valor Est.",
        ],
      ],
      body: reports.map((r) => [
        r.owner.name,
        formatCurrency(r.revenue),
        formatCurrency(r.cost),
        formatCurrency(r.profit),
        formatPercentage(r.profitMargin),
        r.totalStock.toString(),
        formatCurrency(r.inventoryValue),
      ]),
      foot: [
        [
          "TOTAL",
          formatCurrency(totals.revenue),
          formatCurrency(totals.cost),
          formatCurrency(totals.profit),
          formatPercentage(totals.revenue > 0 ? totals.profit / totals.revenue : 0),
          "",
          formatCurrency(totals.inventoryValue),
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
          <p className="text-gray-500">Análise financeira por proprietário</p>
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
            <CardTitle className="text-sm font-medium">Receita Total</CardTitle>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Relatório por Proprietário
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-4">Carregando...</p>
          ) : reports.length === 0 ? (
            <p className="text-center py-4 text-gray-500">
              Nenhum dado encontrado
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proprietário</TableHead>
                  <TableHead className="text-right">Receita</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead className="text-right">Lucro</TableHead>
                  <TableHead className="text-right">Margem</TableHead>
                  <TableHead className="text-right">Estoque (Un)</TableHead>
                  <TableHead className="text-right">Valor Estoque</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => (
                  <TableRow key={report.owner.id}>
                    <TableCell className="font-medium">
                      {report.owner.name}
                    </TableCell>
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
                    <TableCell className="text-right">{report.totalStock}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(report.inventoryValue)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
