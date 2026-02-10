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
import { ClipboardList, Eye, Download, Banknote, CreditCard, Smartphone } from "lucide-react";

interface OrderItem {
  id: string;
  quantity: number;
  unitPrice: number;
  totalRevenue: number;
  profit: number;
  product: {
    name: string;
    sku: string;
  };
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
  }, []);

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
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Lista de Vendas
          </CardTitle>
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
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedOrder(order)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
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
                        <TableCell>{item.product.name}</TableCell>
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
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
