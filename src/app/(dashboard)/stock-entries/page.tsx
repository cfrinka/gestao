"use client";

import { useState, useEffect, useCallback } from "react";
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
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { TotalsStrip } from "@/components/etiqueta/totals-strip";
import { currentMonthISO, todayISO } from "@/lib/dates";
import { loadPdf } from "@/lib/pdf";
import type { jsPDF as JsPdfDoc } from "jspdf";

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
  const [startDate, setStartDate] = useState(() => `${currentMonthISO()}-01`);
  const [endDate, setEndDate] = useState(() => todayISO());

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

  const exportPDF = async () => {
    const { jsPDF, autoTable } = await loadPdf();
    if (!data) return;

    const doc = new jsPDF();
    const setFont = (doc as JsPdfDoc & { setFont: (f: string, s: string) => void }).setFont.bind(doc);

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
        (doc as JsPdfDoc & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || currentY;
      currentY = finalY + 10;
    });

    doc.save(`entradas-estoque-${data.period.start.replace(/\//g, "-")}.pdf`);
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Entradas de estoque"
        meta={<span>Quanto entrou no estoque, pelo preço de custo</span>}
        actions={
          <Button variant="outline" size="sm" onClick={exportPDF} disabled={loading || !data}>
            <FileText className="h-4 w-4" aria-hidden="true" />
            Exportar PDF
          </Button>
        }
        className="mb-0 md:mb-0"
      />

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="startDate" className="text-xs">De</Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 w-[160px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="endDate" className="text-xs">Até</Label>
            <Input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 w-[160px]"
            />
          </div>
        </div>

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          <div className="h-16 animate-pulse border border-rule bg-paper" />
          <div className="h-64 animate-pulse border border-rule bg-paper" />
        </div>
      ) : data ? (
        <>
          <TotalsStrip
            items={[
              { label: "Período", value: <span className="text-lg">{data.period.start} a {data.period.end}</span> },
              { label: "Investido", value: formatCurrency(data.monthTotal) },
              { label: "Peças recebidas", value: data.monthQuantity },
            ]}
          />

          {data.days.length === 0 ? (
            <p className="border border-rule bg-paper px-5 py-12 text-center text-sm text-ink-3">Nenhuma entrada no período.</p>
          ) : (
            <div className="space-y-4">
              {data.days.map((day) => (
                <section key={day.date} className="border border-rule bg-paper" aria-label={`Entradas de ${day.date}`}>
                  <div className="flex items-baseline justify-between gap-3 border-b-2 border-ink px-4 py-2.5">
                    <h3 className="font-tag text-lg font-bold uppercase tracking-[0.04em]">{day.date}</h3>
                    <span className="text-right">
                      <span className="mr-3 text-sm text-ink-3">{day.quantity} peças</span>
                      <span className="font-tag text-xl font-extrabold tabular-nums">{formatCurrency(day.total)}</span>
                    </span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[80px] pl-4">Hora</TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead className="text-right">Qtd</TableHead>
                        <TableHead className="text-right">Custo un.</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="pr-4">Origem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {day.entries.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="pl-4 tabular-nums text-ink-2">{e.time}</TableCell>
                          <TableCell>
                            <span className="font-semibold">{e.productName}</span>
                            <span className="block text-xs tracking-[0.04em] text-ink-3">{e.sku}</span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{e.quantity}</TableCell>
                          <TableCell className="text-right tabular-nums text-ink-2">
                            {formatCurrency(e.unitCost)}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatCurrency(e.totalCost)}
                          </TableCell>
                          <TableCell className="pr-4 text-ink-2">{sourceLabel(e.source)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="border border-rule bg-paper px-5 py-12 text-center text-sm text-ink-3">Nenhum dado encontrado para o período.</p>
      )}
    </div>
  );
}
