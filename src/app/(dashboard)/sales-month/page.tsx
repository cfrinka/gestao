"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
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
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PageHeader } from "@/components/layout/page-header";
import { TotalsStrip } from "@/components/etiqueta/totals-strip";

interface SalesMonthData {
  period: {
    start: string;
    end: string;
  };
  monthTotal: number;
  days: Array<{
    date: string;
    total: number;
    orders: Array<{
      id: string;
      total: number;
      date: string;
      time: string;
      clientName: string;
      paymentMethod: string;
      isFiadoPayment?: boolean;
    }>;
  }>;
}

export default function SalesMonthPage() {
  const { toast } = useToast();
  const [data, setData] = useState<SalesMonthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [endDate, setEndDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);

      const response = await apiGet(`/api/sales-month?${params}`);
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

    // Title
    doc.setFontSize(20);
    doc.text("Relatório de Vendas Mensal", 14, 22);

    // Period and total
    doc.setFontSize(12);
    doc.text(`Período: ${data.period.start} até ${data.period.end}`, 14, 32);
    doc.text(`Total do Mês: ${formatCurrency(data.monthTotal)}`, 14, 40);

    let currentY = 50;

    // Group by day
    data.days.forEach((day) => {
      // Check if we need a new page
      if (currentY > 250) {
        doc.addPage();
        currentY = 20;
      }

      // Day header
      doc.setFontSize(14);
      (doc as jsPDF & { setFont: (font: string, style: string) => void }).setFont("helvetica", "bold");
      doc.text(`${day.date} - Total: ${formatCurrency(day.total)}`, 14, currentY);
      currentY += 10;

      // Day orders table
      doc.setFontSize(10);
      (doc as jsPDF & { setFont: (font: string, style: string) => void }).setFont("helvetica", "normal");

      autoTable(doc, {
        startY: currentY,
        head: [["Hora", "Cliente", "Valor", "Método"]],
        body: day.orders.map((order) => [
          order.time || "",
          order.clientName || "",
          formatCurrency(order.total),
          order.paymentMethod === "DINHEIRO" ? "Dinheiro" :
          order.paymentMethod === "DEBITO" ? "Débito" :
          order.paymentMethod === "CREDITO" ? "Crédito" :
          order.paymentMethod === "PIX" ? "PIX" :
          order.paymentMethod === "cash" ? "Dinheiro" :
          order.paymentMethod === "debit" ? "Débito" :
          order.paymentMethod === "credit" ? "Crédito" :
          order.paymentMethod === "pix" ? "PIX" : (order.paymentMethod || ""),
        ]),
        theme: "plain",
        styles: { fontSize: 9 },
        headStyles: { fillColor: [245, 245, 245] },
        margin: { left: 14, right: 14 },
      });

      // Get the Y position after the table
      const finalY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || currentY;
      currentY = finalY + 10;
    });

    // Save the PDF
    doc.save(`vendas-mensais-${data.period.start.replace(/\//g, "-")}.pdf`);
  };

  const getPaymentMethodName = (method: string) => {
    switch (method) {
      case "DINHEIRO":
      case "cash":
        return "Dinheiro";
      case "DEBITO":
      case "debit":
        return "Débito";
      case "CREDITO":
      case "credit":
        return "Crédito";
      case "PIX":
      case "pix":
        return "PIX";
      default:
        return method;
    }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Vendas mensais"
        meta={<span>Vendas do período, dia a dia</span>}
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
              { label: "Total vendido", value: formatCurrency(data.monthTotal), tone: "positive" },
              { label: "Dias com venda", value: data.days.length },
            ]}
          />

          {data.days.length === 0 ? (
            <p className="border border-rule bg-paper px-5 py-12 text-center text-sm text-ink-3">Nenhuma venda no período.</p>
          ) : (
            <div className="space-y-4">
              {data.days.map((day) => (
                <section key={day.date} className="border border-rule bg-paper" aria-label={`Vendas de ${day.date}`}>
                  <div className="flex items-baseline justify-between gap-3 border-b-2 border-ink px-4 py-2.5">
                    <h3 className="font-tag text-lg font-bold uppercase tracking-[0.04em]">{day.date}</h3>
                    <span className="font-tag text-xl font-extrabold tabular-nums text-verde">{formatCurrency(day.total)}</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[80px] pl-4">Hora</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Forma</TableHead>
                        <TableHead className="pr-4 text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {day.orders.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell className="pl-4 tabular-nums text-ink-2">{order.time}</TableCell>
                          <TableCell>
                            {order.clientName}
                            {order.isFiadoPayment && (
                              <span className="ml-2 inline-block align-[1px]"><Badge variant="secondary">Pagamento de fiado</Badge></span>
                            )}
                          </TableCell>
                          <TableCell className="text-ink-2">{getPaymentMethodName(order.paymentMethod)}</TableCell>
                          <TableCell className="pr-4 text-right font-semibold tabular-nums">
                            {formatCurrency(order.total)}
                          </TableCell>
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
