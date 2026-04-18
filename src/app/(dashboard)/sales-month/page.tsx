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
import { formatCurrency } from "@/lib/utils";
import { apiGet } from "@/lib/api-client";
import { Calendar, FileText, Loader2 } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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

  const fetchData = async () => {
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
  };

  useEffect(() => {
    fetchData();
  }, [startDate, endDate]);

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Vendas Mensais</h1>
          <p className="text-gray-500">Relatório detalhado de vendas organizado por dia</p>
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
              <CardTitle>Resumo do Mês</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-600">Período</p>
                  <p className="text-lg font-semibold">{data.period.start} até {data.period.end}</p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg">
                  <p className="text-sm text-green-600">Total de Vendas</p>
                  <p className="text-2xl font-bold text-green-700">{formatCurrency(data.monthTotal)}</p>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg">
                  <p className="text-sm text-purple-600">Dias com Vendas</p>
                  <p className="text-2xl font-bold text-purple-700">{data.days.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Vendas por Dia</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {data.days.map((day) => (
                  <div key={day.date} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-lg">{day.date}</h3>
                      <span className="text-lg font-bold text-green-600">
                        {formatCurrency(day.total)}
                      </span>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Hora</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Valor</TableHead>
                          <TableHead>Método</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {day.orders.map((order) => (
                          <TableRow key={order.id}>
                            <TableCell>{order.time}</TableCell>
                            <TableCell>
                              <div>
                                {order.clientName}
                                {order.isFiadoPayment && (
                                  <span className="text-xs text-gray-500 block ml-2">
                                    Pagamento de Fiado
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="font-medium">
                              {formatCurrency(order.total)}
                            </TableCell>
                            <TableCell>{getPaymentMethodName(order.paymentMethod)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
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
