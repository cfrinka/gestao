"use client";

import { useState, useEffect, useCallback } from "react";
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
import { formatCurrency } from "@/lib/utils";
import { apiGet } from "@/lib/api-client";
import { Calendar, FileText, Loader2 } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface StockEntry {
  id: string;
  productName: string;
  sku: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  source: string;
  time: string;
  createdByName: string;
}

interface StockEntriesData {
  period: { start: string; end: string };
  monthTotal: number;
  monthQuantity: number;
  days: Array<{
    date: string;
    total: number;
    quantity: number;
    entries: StockEntry[];
  }>;
}

function sourceLabel(source: string) {
  if (source === "PRODUCT_CREATE") return "Cadastro";
  if (source === "STOCK_REPLENISHMENT") return "Reposição";
  return source;
}

export default function StockEntriesPage() {
  const { toast } = useToast();
  const [data, setData] = useState<StockEntriesData | null>(null);
  const [loading, setLoading] = useState(true);
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [startDate, setStartDate] = useState(firstOfMonth.toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split("T")[0]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      const response = await apiGet(`/api/stock-entries?${params}`);
      setData(response);
    } catch (error) {
      toast({
        title: "Erro ao carregar dados",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const exportPDF = () => {
    if (!data) return;

    const doc = new jsPDF();
    const setFont = (doc as jsPDF & { setFont: (f: string, s: string) => void }).setFont.bind(doc);

    doc.setFontSize(20);
    doc.text("Entradas de Estoque", 14, 22);

    doc.setFontSize(12);
    doc.text(`Período: ${data.period.start} até ${data.period.end}`, 14, 32);
    doc.text(`Total investido: ${formatCurrency(data.monthTotal)}`, 14, 40);
    doc.text(`Peças recebidas: ${data.monthQuantity}`, 14, 48);

    let currentY = 58;

    data.days.forEach((day) => {
      if (currentY > 250) {
        doc.addPage();
        currentY = 20;
      }

      doc.setFontSize(14);
      setFont("helvetica", "bold");
      doc.text(
        `${day.date} - ${day.quantity} pçs - ${formatCurrency(day.total)}`,
        14,
        currentY
      );
      currentY += 8;

      doc.setFontSize(10);
      setFont("helvetica", "normal");

      autoTable(doc, {
        startY: currentY,
        head: [["Hora", "Produto", "SKU", "Qtd", "Custo un.", "Total", "Origem"]],
        body: day.entries.map((e) => [
          e.time,
          e.productName,
          e.sku,
          String(e.quantity),
          formatCurrency(e.unitCost),
          formatCurrency(e.totalCost),
          sourceLabel(e.source),
        ]),
        theme: "plain",
        styles: { fontSize: 9 },
        headStyles: { fillColor: [245, 245, 245] },
        margin: { left: 14, right: 14 },
      });

      const finalY =
        (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || currentY;
      currentY = finalY + 10;
    });

    doc.save(`entradas-estoque-${data.period.start.replace(/\//g, "-")}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Entradas de Estoque</h1>
          <p className="text-gray-500">Total investido em estoque no período (pelo preço de custo)</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportPDF} disabled={loading || !data}>
            <FileText className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Período
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">Data Inicial</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">Data Final</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin" />
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Resumo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-600">Período</p>
                  <p className="text-lg font-semibold">
                    {data.period.start} até {data.period.end}
                  </p>
                </div>
                <div className="p-4 bg-orange-50 rounded-lg">
                  <p className="text-sm text-orange-600">Total investido</p>
                  <p className="text-2xl font-bold text-orange-700">
                    {formatCurrency(data.monthTotal)}
                  </p>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg">
                  <p className="text-sm text-purple-600">Peças recebidas</p>
                  <p className="text-2xl font-bold text-purple-700">{data.monthQuantity}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Entradas por Dia</CardTitle>
            </CardHeader>
            <CardContent>
              {data.days.length === 0 ? (
                <p className="text-gray-500 text-sm">Nenhuma entrada no período</p>
              ) : (
                <div className="space-y-6">
                  {data.days.map((day) => (
                    <div key={day.date} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-lg">{day.date}</h3>
                        <div className="text-right">
                          <div className="text-sm text-gray-500">{day.quantity} peças</div>
                          <div className="text-lg font-bold text-orange-600">
                            {formatCurrency(day.total)}
                          </div>
                        </div>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Hora</TableHead>
                            <TableHead>Produto</TableHead>
                            <TableHead>SKU</TableHead>
                            <TableHead className="text-right">Qtd</TableHead>
                            <TableHead className="text-right">Custo un.</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead>Origem</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {day.entries.map((e) => (
                            <TableRow key={e.id}>
                              <TableCell>{e.time}</TableCell>
                              <TableCell>{e.productName}</TableCell>
                              <TableCell className="text-xs text-gray-500">{e.sku}</TableCell>
                              <TableCell className="text-right">{e.quantity}</TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(e.unitCost)}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatCurrency(e.totalCost)}
                              </TableCell>
                              <TableCell>{sourceLabel(e.source)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-gray-500">Nenhum dado encontrado</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
