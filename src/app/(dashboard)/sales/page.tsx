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
  owner: {
    name: string;
  };
}

interface OwnerLedger {
  id: string;
  revenue: number;
  cost: number;
  profit: number;
  owner: {
    name: string;
  };
}

interface PaymentMethod {
  method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX";
  amount: number;
}

interface Order {
  id: string;
  createdAt: string;
  totalAmount: number;
  payments?: PaymentMethod[];
  items: OrderItem[];
  ledgers: OwnerLedger[];
  clientId?: string;
  clientName?: string;
  isPaidLater?: boolean;
  paidAt?: string;
}

export default function SalesPage() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const fetchOrders = async () => {
    setLoading(true);
    try {
      let url = "/api/orders";
      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
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
    fetchOrders();
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
                            {order.paidAt ? 'Fiado (Pago)' : 'Fiado'}
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
                    </div>
                    {selectedOrder.paidAt && (
                      <p className="text-xs text-green-600">
                        Pago em: {formatDate(new Date(selectedOrder.paidAt))}
                      </p>
                    )}
                  </div>
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
                      <TableHead>Proprietário</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Preço</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedOrder.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.product.name}</TableCell>
                        <TableCell>{item.owner.name}</TableCell>
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

              <div>
                <h4 className="font-semibold mb-2">Divisão por Proprietário</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Proprietário</TableHead>
                      <TableHead className="text-right">Receita</TableHead>
                      <TableHead className="text-right">Custo</TableHead>
                      <TableHead className="text-right">Lucro</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedOrder.ledgers.map((ledger) => (
                      <TableRow key={ledger.id}>
                        <TableCell>{ledger.owner.name}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(ledger.revenue)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(ledger.cost)}
                        </TableCell>
                        <TableCell className="text-right text-green-600 font-bold">
                          {formatCurrency(ledger.profit)}
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
