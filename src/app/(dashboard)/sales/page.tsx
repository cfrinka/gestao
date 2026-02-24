"use client";

import { useState, useEffect } from "react";
import { apiGet } from "@/lib/api-client";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ClipboardList, Eye, Download, Banknote, CreditCard, Smartphone, Printer } from "lucide-react";

interface OrderItem {
  id: string;
  quantity: number;
  size?: string;
  unitPrice: number;
  totalRevenue: number;
  profit: number;
  product?: {
    name: string;
    sku: string;
  };
}

interface StoreSettings {
  storeName: string;
  address: string;
  phone: string;
  cnpj: string;
  footerMessage: string;
  exchangeDays: number;
}

interface PaymentMethod {
  method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX";
  amount: number;
}

interface FiadoPayment {
  id: string;
  amount: number;
  method: PaymentMethod["method"];
  createdAt: string;
}

interface Order {
  id: string;
  createdAt: string;
  totalAmount: number;
  payments?: PaymentMethod[];
  items: OrderItem[];
  clientId?: string;
  clientName?: string;
  isPaidLater?: boolean;
  amountPaid?: number;
  remainingAmount?: number;
  paymentHistory?: FiadoPayment[];
  paidAt?: string;
}

export default function SalesPage() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [storeSettings, setStoreSettings] = useState<StoreSettings>({
    storeName: "Gestão Loja",
    address: "",
    phone: "",
    cnpj: "",
    footerMessage: "Obrigado pela preferência!\nVolte sempre!",
    exchangeDays: 10,
  });

  const periodTotalSold = orders.reduce(
    (sum, o) => sum + (typeof o.totalAmount === "number" ? o.totalAmount : 0),
    0
  );

  const periodFiadoOutstanding = orders.reduce((sum, o) => {
    if (!o.isPaidLater) return sum;
    if (typeof o.remainingAmount === "number") return sum + o.remainingAmount;
    return sum + (o.paidAt ? 0 : (typeof o.totalAmount === "number" ? o.totalAmount : 0));
  }, 0);

  const periodReceived = orders.reduce((sum, o) => {
    const total = typeof o.totalAmount === "number" ? o.totalAmount : 0;
    if (!o.isPaidLater) return sum + total;
    if (typeof o.amountPaid === "number") return sum + o.amountPaid;
    return sum + (o.paidAt ? total : 0);
  }, 0);

  const fetchOrders = async (override?: { startDate?: string; endDate?: string }) => {
    setLoading(true);
    try {
      const effectiveStartDate = override?.startDate ?? startDate;
      const effectiveEndDate = override?.endDate ?? endDate;

      let url = "/api/orders";
      const params = new URLSearchParams();
      if (effectiveStartDate) params.append("startDate", effectiveStartDate);
      if (effectiveEndDate) params.append("endDate", effectiveEndDate);
      if (params.toString()) url += `?${params.toString()}`;

      const data = await apiGet(url);
      setOrders(Array.isArray(data) ? data : []);
    } catch (error) {
      toast({ title: "Erro ao carregar vendas", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    fetchStoreSettings();
  }, []);

  const fetchStoreSettings = async () => {
    try {
      const data = await apiGet("/api/settings");
      setStoreSettings({
        storeName: data.storeName || "Gestão Loja",
        address: data.address || "",
        phone: data.phone || "",
        cnpj: data.cnpj || "",
        footerMessage: data.footerMessage || "Obrigado pela preferência!\nVolte sempre!",
        exchangeDays: Number.isFinite(data.exchangeDays) ? data.exchangeDays : 10,
      });
    } catch {
      // keep default settings
    }
  };

  const printReceipt = (order: Order) => {
    if (!order) return;

    const receiptWindow = window.open("", "_blank", "width=420,height=700");
    if (!receiptWindow) {
      toast({ title: "Erro ao abrir janela de impressão", variant: "destructive" });
      return;
    }

    const createdAtDate = new Date(order.createdAt);
    const dateStr = createdAtDate.toLocaleDateString("pt-BR");
    const timeStr = createdAtDate.toLocaleTimeString("pt-BR");
    const exchangeDays = Number.isFinite(storeSettings.exchangeDays) ? Math.max(0, Math.floor(storeSettings.exchangeDays)) : 10;
    const exchangeDeadline = new Date(createdAtDate);
    exchangeDeadline.setDate(exchangeDeadline.getDate() + exchangeDays);
    const exchangeDeadlineStr = exchangeDeadline.toLocaleDateString("pt-BR");

    const subtotal = order.items.reduce((sum, item) => sum + Number(item.totalRevenue || 0), 0);
    const discount = Math.max(0, subtotal - Number(order.totalAmount || 0));

    const paymentLabel: Record<PaymentMethod["method"], string> = {
      DINHEIRO: "Dinheiro",
      DEBITO: "Debito",
      CREDITO: "Credito",
      PIX: "PIX",
    };

    const itemsRows = order.items
      .map((item) => {
        const productName = item.product?.name || "Produto removido";
        const itemName = `${productName}${item.size ? ` (${item.size})` : ""}`;
        const itemTotal = Number(item.totalRevenue || 0);
        return `<tr><td>${item.quantity}x ${itemName}</td><td class="right">${formatCurrency(itemTotal)}</td></tr>`;
      })
      .join("");

    const paymentsRows = (order.payments || [])
      .map((payment) => `<tr><td>${paymentLabel[payment.method] || payment.method}</td><td class="right">${formatCurrency(payment.amount)}</td></tr>`)
      .join("");

    const paymentSection = order.isPaidLater
      ? `<div class="divider"></div><div class="section muted"><div class="meta"><strong>Pagamento:</strong> Fiado</div></div>`
      : (order.payments && order.payments.length > 0
        ? `<div class="divider"></div><table><tbody>${paymentsRows}</tbody></table>`
        : "");

    receiptWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Reimpressao de Cupom</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body { width: 80mm; max-width: 80mm; }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 11px;
            line-height: 1.3;
            font-weight: 600;
            color: #000;
            padding: 0;
            overflow-wrap: anywhere;
            word-break: break-word;
          }
          .receipt { width: 80mm; max-width: 80mm; padding: 2.5mm 2.5mm 3mm; break-after: page; page-break-after: always; }
          .receipt:last-child { break-after: auto; page-break-after: auto; }
          .center { text-align: center; overflow-wrap: anywhere; word-break: break-word; }
          .bold { font-weight: bold; }
          .divider { margin: 8px 0; border-top: 1px dashed #000; }
          .section { margin: 6px 0; }
          .muted { font-size: 11px; }
          .store-name { font-size: 15px; line-height: 1.2; letter-spacing: 0.3px; }
          .line { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
          .meta { margin: 2px 0; }
          .meta strong { display: inline-block; min-width: 78px; }
          .policy { margin: 6px 0; text-align: left; }
          .policy-line { display: block; line-height: 1.3; }
          .validity { text-align: center; margin-top: 6px; }
          .footer-note { text-align: center; }
          .title { font-size: 14px; margin-bottom: 4px; }
          table { width: 100%; border-collapse: collapse; }
          td { vertical-align: top; padding: 1px 0; }
          td.right { text-align: right; white-space: nowrap; padding-left: 8px; }
          .totals td { padding-top: 2px; }
          @media print {
            html, body { width: 80mm !important; max-width: 80mm !important; }
            @page { margin: 0; size: 80mm auto; }
            .receipt { break-after: page; page-break-after: always; }
            .receipt:last-child { break-after: auto; page-break-after: auto; }
          }
        </style>
      </head>
      <body>
        <div class="receipt">
          <div class="center">
            <div class="bold store-name line">${storeSettings.storeName.toUpperCase()}</div>
            ${storeSettings.address ? `<div class="line">${storeSettings.address}</div>` : ""}
            ${storeSettings.phone ? `<div class="line">Tel: ${storeSettings.phone}</div>` : ""}
            ${storeSettings.cnpj ? `<div class="line">CNPJ: ${storeSettings.cnpj}</div>` : ""}
          </div>

          <div class="divider"></div>

          <div class="center title bold">CUPOM NAO FISCAL</div>

          <div class="section muted">
            <div class="meta"><strong>Data:</strong> ${dateStr}</div>
            <div class="meta"><strong>Hora:</strong> ${timeStr}</div>
            <div class="meta"><strong>Documento:</strong> #${order.id.slice(-6).toUpperCase()}</div>
            <div class="meta"><strong>Tipo:</strong> Reimpressao</div>
          </div>

          <div class="divider"></div>

          <table>
            <tbody>${itemsRows}</tbody>
          </table>

          <div class="divider"></div>

          <table class="totals">
            <tbody>
              <tr><td>Subtotal</td><td class="right">${formatCurrency(subtotal)}</td></tr>
              ${discount > 0 ? `<tr><td>Desconto</td><td class="right">-${formatCurrency(discount)}</td></tr>` : ""}
              <tr><td><strong>Total</strong></td><td class="right"><strong>${formatCurrency(order.totalAmount)}</strong></td></tr>
            </tbody>
          </table>

          ${paymentSection}

          <div class="divider"></div>
          <div class="center muted">Documento sem valor fiscal</div>
        </div>

        <div class="receipt">
          <div class="center">
            <div class="bold store-name line">${storeSettings.storeName.toUpperCase()}</div>
            ${storeSettings.address ? `<div class="line">${storeSettings.address}</div>` : ""}
            ${storeSettings.phone ? `<div class="line">Tel: ${storeSettings.phone}</div>` : ""}
          </div>

          <div class="divider"></div>

          <div class="section muted">
            <div class="meta"><strong>Data:</strong> ${dateStr}</div>
            <div class="meta"><strong>Hora:</strong> ${timeStr}</div>
            <div class="meta"><strong>Documento:</strong> #${order.id.slice(-6).toUpperCase()}</div>
            <div class="meta"><strong>Tipo:</strong> Reimpressao</div>
          </div>

          <div class="divider"></div>

          <div class="center section">
            <div class="bold title">COMPROVANTE PARA TROCA</div>
            <div class="section policy">
              <span class="policy-line">Trocas em ate ${exchangeDays} dias</span>
              <span class="policy-line">corridos, mediante apresentacao</span>
              <span class="policy-line">deste comprovante.</span>
            </div>
            <div class="validity"><strong>Valido ate:</strong> ${exchangeDeadlineStr}</div>
            <div class="muted footer-note">Produto deve estar sem uso e com etiqueta.</div>
          </div>

          ${storeSettings.footerMessage
            ? `<div class="divider"></div><div class="center section muted">${storeSettings.footerMessage.split("\n").map((line) => `<div class="line">${line}</div>`).join("")}</div>`
            : ""}

          <div class="divider"></div>
          <div class="center muted"><strong>REIMPRESSAO DE CUPOM</strong></div>
        </div>

        <script>
          window.onload = function() {
            window.print();
            window.onafterprint = function() { window.close(); };
          };
        </script>
      </body>
      </html>
    `);

    receiptWindow.document.close();
  };

  const handleFilter = () => {
    fetchOrders();
  };

  const handleClearFilter = () => {
    setStartDate("");
    setEndDate("");
    fetchOrders({ startDate: "", endDate: "" });
  };

  const applyPreset = (preset: "today" | "yesterday" | "this_week" | "this_month" | "last_30" | "last_90" | "all") => {
    const today = new Date();
    const toISO = (d: Date) => d.toISOString().split("T")[0];

    if (preset === "all") {
      setStartDate("");
      setEndDate("");
      fetchOrders({ startDate: "", endDate: "" });
      return;
    }

    if (preset === "today") {
      const t = toISO(today);
      setStartDate(t);
      setEndDate(t);
      fetchOrders({ startDate: t, endDate: t });
      return;
    }

    if (preset === "yesterday") {
      const y = new Date(today);
      y.setDate(today.getDate() - 1);
      const d = toISO(y);
      setStartDate(d);
      setEndDate(d);
      fetchOrders({ startDate: d, endDate: d });
      return;
    }

    if (preset === "this_week") {
      const dayOfWeek = today.getDay();
      const monday = new Date(today);
      monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      const start = toISO(monday);
      const end = toISO(today);
      setStartDate(start);
      setEndDate(end);
      fetchOrders({ startDate: start, endDate: end });
      return;
    }

    if (preset === "this_month") {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      const start = toISO(firstDay);
      const end = toISO(today);
      setStartDate(start);
      setEndDate(end);
      fetchOrders({ startDate: start, endDate: end });
      return;
    }

    if (preset === "last_30" || preset === "last_90") {
      const days = preset === "last_30" ? 30 : 90;
      const start = new Date(today);
      start.setDate(today.getDate() - days);
      const startIso = toISO(start);
      const endIso = toISO(today);
      setStartDate(startIso);
      setEndDate(endIso);
      fetchOrders({ startDate: startIso, endDate: endIso });
    }
  };

  const exportCSV = () => {
    const headers = ["ID", "Data", "Total", "Itens"];
    const rows = orders.map((order) => [
      order.id,
      new Date(order.createdAt).toLocaleString("pt-BR"),
      order.totalAmount.toFixed(2),
      order.items.length.toString(),
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vendas-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Vendas</h1>
          <p className="text-gray-500">Histórico de vendas realizadas</p>
        </div>
        <Button variant="outline" onClick={exportCSV}>
          <Download className="h-4 w-4 mr-2" />
          Exportar CSV
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-4">
            <Button variant="outline" size="sm" onClick={() => applyPreset("today")}>Hoje</Button>
            <Button variant="outline" size="sm" onClick={() => applyPreset("yesterday")}>Ontem</Button>
            <Button variant="outline" size="sm" onClick={() => applyPreset("this_week")}>Esta Semana</Button>
            <Button variant="outline" size="sm" onClick={() => applyPreset("this_month")}>Este Mês</Button>
            <Button variant="outline" size="sm" onClick={() => applyPreset("last_30")}>Últimos 30 dias</Button>
            <Button variant="outline" size="sm" onClick={() => applyPreset("last_90")}>Últimos 90 dias</Button>
            <Button variant="outline" size="sm" onClick={() => applyPreset("all")}>Todo Período</Button>
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
            <Button variant="outline" onClick={handleClearFilter}>
              Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Lista de Vendas
            </CardTitle>
            <div className="text-sm text-gray-600 grid grid-cols-1 gap-1 text-right">
              <div>
                <span className="font-medium">Total vendido:</span> {formatCurrency(periodTotalSold)}
              </div>
              <div>
                <span className="font-medium">Total fiado (pendente):</span> {formatCurrency(periodFiadoOutstanding)}
              </div>
              <div>
                <span className="font-medium">Total recebido:</span> {formatCurrency(periodReceived)}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-4">Carregando...</p>
          ) : orders.length === 0 ? (
            <p className="text-center py-4 text-gray-500">
              Nenhuma venda encontrada
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders?.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">
                      #{order.id.slice(-6).toUpperCase()}
                    </TableCell>
                    <TableCell>{formatDate(new Date(order.createdAt))}</TableCell>
                    <TableCell>{order.items.length}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {order.isPaidLater ? (
                          <span className={`text-xs px-2 py-1 rounded ${order.paidAt ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                            {order.paidAt
                              ? 'Fiado (Pago)'
                              : `Fiado (${formatCurrency(order.remainingAmount ?? order.totalAmount)})`}
                          </span>
                        ) : (
                          <>
                            {order.payments?.map((p, i) => (
                              <span key={i} className="text-xs bg-gray-100 px-2 py-1 rounded">
                                {p.method === "DINHEIRO" && "Dinheiro"}
                                {p.method === "DEBITO" && "Débito"}
                                {p.method === "CREDITO" && "Crédito"}
                                {p.method === "PIX" && "PIX"}
                              </span>
                            ))}
                            {(!order.payments || order.payments.length === 0) && (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {order.clientName ? (
                        <span className="text-sm text-blue-600">{order.clientName}</span>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      {formatCurrency(order.totalAmount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => printReceipt(order)}
                          title="Reimprimir cupom"
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setSelectedOrder(order)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Detalhes do Pedido #{selectedOrder?.id.slice(-6).toUpperCase()}
            </DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Data: {formatDate(new Date(selectedOrder.createdAt))}</span>
                <span className="font-bold text-lg">
                  Total: {formatCurrency(selectedOrder.totalAmount)}
                </span>
              </div>

              {selectedOrder.isPaidLater && (
                <div className={`p-3 rounded-lg ${selectedOrder.paidAt ? 'bg-green-50 border border-green-200' : 'bg-orange-50 border border-orange-200'}`}>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className={`font-medium ${selectedOrder.paidAt ? 'text-green-700' : 'text-orange-700'}`}>
                        {selectedOrder.paidAt ? 'Venda Fiado (Pago)' : 'Venda Fiado (Pendente)'}
                      </p>
                      <p className="text-sm text-gray-600">Cliente: {selectedOrder.clientName}</p>
                      <p className="text-xs text-gray-600">
                        Pago: {formatCurrency(selectedOrder.amountPaid || 0)} | Restante: {formatCurrency(selectedOrder.remainingAmount ?? selectedOrder.totalAmount)}
                      </p>
                    </div>
                    {selectedOrder.paidAt && (
                      <p className="text-xs text-green-600">
                        Pago em: {formatDate(new Date(selectedOrder.paidAt))}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {selectedOrder.isPaidLater && selectedOrder.paymentHistory && selectedOrder.paymentHistory.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Histórico de Pagamentos</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Forma</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedOrder.paymentHistory.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{formatDate(new Date(p.createdAt))}</TableCell>
                          <TableCell>
                            {p.method === "DINHEIRO" && "Dinheiro"}
                            {p.method === "DEBITO" && "Débito"}
                            {p.method === "CREDITO" && "Crédito"}
                            {p.method === "PIX" && "PIX"}
                          </TableCell>
                          <TableCell className="text-right">{formatCurrency(p.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {selectedOrder.payments && selectedOrder.payments.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Formas de Pagamento</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedOrder.payments.map((payment, index) => (
                      <div key={index} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                        {payment.method === "DINHEIRO" && <Banknote className="h-4 w-4 text-green-600" />}
                        {payment.method === "DEBITO" && <CreditCard className="h-4 w-4 text-blue-600" />}
                        {payment.method === "CREDITO" && <CreditCard className="h-4 w-4 text-purple-600" />}
                        {payment.method === "PIX" && <Smartphone className="h-4 w-4 text-teal-600" />}
                        <span className="text-sm">
                          {payment.method === "DINHEIRO" && "Dinheiro"}
                          {payment.method === "DEBITO" && "Débito"}
                          {payment.method === "CREDITO" && "Crédito"}
                          {payment.method === "PIX" && "PIX"}
                        </span>
                        <span className="ml-auto font-medium">{formatCurrency(payment.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h4 className="font-semibold mb-2">Itens</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Preço</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedOrder.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.product?.name || "Produto removido"}</TableCell>
                        <TableCell className="text-right">
                          {item.quantity}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.unitPrice)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.totalRevenue)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-end">
                <Button variant="outline" onClick={() => printReceipt(selectedOrder)}>
                  <Printer className="h-4 w-4 mr-2" />
                  Reimprimir cupom
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
