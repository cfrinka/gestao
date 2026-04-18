"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { apiGet, apiPost, apiPut, apiDelete, apiPatch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/utils";
import { Plus, Pencil, Trash2, Users, CreditCard, Eye, Printer, X } from "lucide-react";

interface Order {
  id: string;
  totalAmount: number;
  createdAt: string;
  amountPaid?: number;
  remainingAmount?: number;
  items?: OrderItem[];
}

interface OrderItem {
  id: string;
  productName?: string;
  size?: string;
  quantity: number;
}

interface Client {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  balance: number;
  pendingOrders?: Order[];
}

export default function ClientsPage() {
  const { userData } = useAuth();
  const { toast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [removingOrderItemId, setRemovingOrderItemId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"DINHEIRO" | "DEBITO" | "CREDITO" | "PIX">("DINHEIRO");
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    notes: "",
  });

  const fetchClients = async () => {
    try {
      const data = await apiGet("/api/clients");
      setClients(Array.isArray(data) ? data : []);
    } catch {
      toast({ title: "Erro ao carregar clientes", variant: "destructive" });
      setClients([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveOrderItem = async (orderId: string, orderItemId: string) => {
    if (!selectedClient) return;

    const confirmed = confirm("Remover este item do pedido? O estoque será devolvido e o saldo pendente será recalculado.");
    if (!confirmed) return;

    try {
      setRemovingOrderItemId(orderItemId);
      const updated = await apiPatch(`/api/clients/${selectedClient.id}`, {
        action: "remove_order_item",
        orderId,
        orderItemId,
      });
      setSelectedClient({ ...updated, pendingOrders: updated.pendingOrders || [] });
      toast({ title: "Item removido com sucesso" });
      fetchClients();
    } catch (error) {
      toast({
        title: "Erro ao remover item",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setRemovingOrderItemId(null);
    }
  };

  const printClientDebtDetails = (client: Client) => {
    const printWindow = window.open("", "_blank", "width=420,height=700");
    if (!printWindow) {
      toast({ title: "Erro ao abrir janela de impressão", variant: "destructive" });
      return;
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString("pt-BR");
    const timeStr = now.toLocaleTimeString("pt-BR");
    const pendingOrders = client.pendingOrders || [];
    const totalPending = pendingOrders.reduce((sum, order) => {
      const remaining = typeof order.remainingAmount === "number" ? order.remainingAmount : order.totalAmount;
      return sum + remaining;
    }, 0);

    const ordersHtml = pendingOrders.length
      ? pendingOrders
          .map((order) => {
            const remaining = typeof order.remainingAmount === "number" ? order.remainingAmount : order.totalAmount;
            const paid = typeof order.amountPaid === "number" ? order.amountPaid : 0;
            const itemsHtml = order.items && order.items.length > 0
              ? order.items
                  .map((item) => `<div class="item-line">${item.quantity}x ${item.productName || "Produto removido"}${item.size ? ` (${item.size})` : ""}</div>`)
                  .join("")
              : '<div class="item-line">Sem itens detalhados</div>';

            return `
              <div class="order-block">
                <div class="row"><span class="label">Pedido:</span><span>#${order.id.slice(-6).toUpperCase()}</span></div>
                <div class="row"><span class="label">Data:</span><span>${new Date(order.createdAt).toLocaleDateString("pt-BR")}</span></div>
                <div class="row"><span class="label">Pago:</span><span>${formatCurrency(paid)}</span></div>
                <div class="row bold"><span class="label">Restante:</span><span>${formatCurrency(remaining)}</span></div>
                <div class="items">${itemsHtml}</div>
              </div>
            `;
          })
          .join("")
      : '<div class="empty">Nenhum pedido pendente.</div>';

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Detalhes</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            html, body { width: 80mm; max-width: 80mm; }
            body {
              font-family: 'Courier New', Courier, monospace;
              font-size: 11px;
              line-height: 1.3;
              font-weight: 600;
              color: #000;
              padding: 2.5mm 2.5mm 3mm;
              overflow-wrap: anywhere;
              word-break: break-word;
            }
            .center { text-align: center; }
            .title { font-size: 14px; font-weight: bold; margin-bottom: 4px; }
            .divider { margin: 8px 0; border-top: 1px dashed #000; }
            .section { margin: 6px 0; }
            .row { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
            .label { color: #333; }
            .bold { font-weight: bold; }
            .order-block { border: 1px dashed #000; padding: 6px; margin: 6px 0; }
            .items { margin-top: 4px; }
            .item-line { font-size: 10px; margin: 1px 0; }
            .total { font-size: 13px; font-weight: bold; text-align: right; }
            .empty { text-align: center; margin: 8px 0; }
            @media print {
              html, body { width: 80mm !important; max-width: 80mm !important; }
              @page { margin: 0; size: 80mm auto; }
            }
          </style>
        </head>
        <body>
          <div class="center title">DETALHES</div>
          <div class="divider"></div>

          <div class="section">
            <div class="row"><span class="label">Cliente:</span><span>${client.name}</span></div>
            ${client.phone ? `<div class="row"><span class="label">Telefone:</span><span>${client.phone}</span></div>` : ""}
            <div class="row"><span class="label">Emissão:</span><span>${dateStr} ${timeStr}</span></div>
          </div>

          <div class="divider"></div>
          <div class="section">
            <div class="bold">Pedidos Pendentes</div>
            ${ordersHtml}
          </div>

          <div class="divider"></div>
          <div class="total">TOTAL PENDENTE: ${formatCurrency(totalPending)}</div>

          <script>
            window.onload = function() {
              window.print();
              window.onafterprint = function() { window.close(); };
            };
          </script>
        </body>
      </html>
    `);

    printWindow.document.close();
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (editingClient) {
        await apiPut(`/api/clients/${editingClient.id}`, formData);
        toast({ title: "Cliente atualizado!" });
      } else {
        await apiPost("/api/clients", formData);
        toast({ title: "Cliente criado!" });
      }
      setDialogOpen(false);
      resetForm();
      fetchClients();
    } catch (error) {
      toast({
        title: "Erro",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este cliente?")) return;

    try {
      await apiDelete(`/api/clients/${id}`);
      toast({ title: "Cliente excluído!" });
      fetchClients();
    } catch (error) {
      toast({ 
        title: "Erro ao excluir cliente", 
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive" 
      });
    }
  };

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setFormData({
      name: client.name,
      phone: client.phone || "",
      email: client.email || "",
      notes: client.notes || "",
    });
    setDialogOpen(true);
  };

  const handleViewDetails = async (client: Client) => {
    try {
      const data = await apiGet(`/api/clients/${client.id}`);
      setSelectedClient(data);
      setDetailsOpen(true);
    } catch {
      toast({ title: "Erro ao carregar detalhes", variant: "destructive" });
    }
  };

  const openPayDialog = (order: Order) => {
    setPayingOrderId(order.id);
    const remaining = typeof order.remainingAmount === "number" ? order.remainingAmount : order.totalAmount;
    setPaymentAmount(remaining.toFixed(2));
    setPaymentMethod("DINHEIRO");
    setPaymentDialogOpen(true);
  };

  const handleConfirmPayment = async () => {
    if (!selectedClient || !payingOrderId) return;

    const parsed = parseFloat(paymentAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({ title: "Informe um valor válido", variant: "destructive" });
      return;
    }

    try {
      const updated = await apiPatch(`/api/clients/${selectedClient.id}`, {
        action: "pay_order",
        orderId: payingOrderId,
        amount: parsed,
        method: paymentMethod,
      });
      setSelectedClient({ ...updated, pendingOrders: updated.pendingOrders || [] });
      toast({ title: "Pagamento registrado!" });
      setPaymentDialogOpen(false);
      setPayingOrderId(null);
      fetchClients();
    } catch {
      toast({ title: "Erro ao registrar pagamento", variant: "destructive" });
    }
  };

  const resetForm = () => {
    setEditingClient(null);
    setFormData({
      name: "",
      phone: "",
      email: "",
      notes: "",
    });
  };

  const openNewDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  // Only ADMIN can access this page
  if (userData?.role === "CASHIER") {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-500">Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  const totalPending = clients.reduce((sum, c) => sum + c.balance, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Clientes</h1>
          <p className="text-gray-500">Gerencie clientes e pagamentos pendentes</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNewDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Novo Cliente
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingClient ? "Editar Cliente" : "Novo Cliente"}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Telefone</Label>
                    <Input
                      id="phone"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Observações</Label>
                  <Textarea
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                  />
                </div>
                <div className="flex gap-2 pt-4">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" className="flex-1">
                    {editingClient ? "Salvar" : "Criar"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Clientes</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{clients.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Pendente</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalPending > 0 ? "text-red-600" : "text-green-600"}`}>
              {formatCurrency(totalPending)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lista de Clientes</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-4">Carregando...</p>
          ) : clients.length === 0 ? (
            <p className="text-center py-4 text-gray-500">Nenhum cliente cadastrado</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Saldo Pendente</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell className="font-medium">{client.name}</TableCell>
                    <TableCell>{client.phone || "-"}</TableCell>
                    <TableCell>{client.email || "-"}</TableCell>
                    <TableCell className={`text-right font-bold ${client.balance > 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatCurrency(client.balance)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleViewDetails(client)}
                          title="Ver detalhes"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(client)}
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(client.id)}
                          className="text-red-500"
                          title="Excluir"
                        >
                          <Trash2 className="h-4 w-4" />
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

      {/* Client Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalhes do Cliente</DialogTitle>
          </DialogHeader>
          {selectedClient && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Nome</p>
                  <p className="font-medium">{selectedClient.name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Saldo Pendente</p>
                  <p className={`font-bold ${selectedClient.balance > 0 ? "text-red-600" : "text-green-600"}`}>
                    {formatCurrency(selectedClient.balance)}
                  </p>
                </div>
                {selectedClient.phone && (
                  <div>
                    <p className="text-sm text-gray-500">Telefone</p>
                    <p className="font-medium">{selectedClient.phone}</p>
                  </div>
                )}
                {selectedClient.email && (
                  <div>
                    <p className="text-sm text-gray-500">Email</p>
                    <p className="font-medium">{selectedClient.email}</p>
                  </div>
                )}
              </div>

              {selectedClient.notes && (
                <div>
                  <p className="text-sm text-gray-500">Observações</p>
                  <p className="font-medium">{selectedClient.notes}</p>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">Pedidos Pendentes</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => printClientDebtDetails(selectedClient)}
                  >
                    <Printer className="h-4 w-4 mr-2" />
                    Imprimir 80mm
                  </Button>
                </div>
                {selectedClient.pendingOrders && selectedClient.pendingOrders.length > 0 ? (
                  <div className="space-y-2">
                    {selectedClient.pendingOrders.map((order) => {
                      const remaining = typeof order.remainingAmount === "number" ? order.remainingAmount : order.totalAmount;
                      const paid = typeof order.amountPaid === "number" ? order.amountPaid : 0;
                      const isFullyPaid = remaining <= 0;
                      return (
                      <div key={order.id} className={`flex items-center justify-between p-3 rounded-lg ${isFullyPaid ? 'bg-green-50 border border-green-200' : 'bg-gray-50'}`}>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">Pedido #{order.id.slice(-6).toUpperCase()}</p>
                            {isFullyPaid && (
                              <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Pago</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500">
                            {new Date(order.createdAt).toLocaleDateString("pt-BR")}
                          </p>
                          <p className="text-xs text-gray-600">
                            Pago: {formatCurrency(paid)} {isFullyPaid ? '' : `| Restante: ${formatCurrency(remaining)}`}
                          </p>
                          {order.items && order.items.length > 0 && (
                            <div className="pt-1">
                              <p className="text-xs font-medium text-gray-700">Itens comprados:</p>
                              <ul className="text-xs text-gray-600 space-y-1">
                                {order.items.map((item) => (
                                  <li key={item.id} className="flex items-center justify-between gap-2">
                                    <span>
                                      {item.quantity}x {item.productName || "Produto removido"}
                                      {item.size ? ` (${item.size})` : ""}
                                    </span>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-red-500"
                                      title="Remover item"
                                      disabled={removingOrderItemId === item.id || isFullyPaid}
                                      onClick={() => handleRemoveOrderItem(order.id, item.id)}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </Button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`font-bold ${isFullyPaid ? 'text-green-600' : 'text-red-600'}`}>
                            {isFullyPaid ? formatCurrency(paid) : formatCurrency(remaining)}
                          </span>
                          {!isFullyPaid && (
                            <Button size="sm" onClick={() => openPayDialog(order)}>
                              Receber
                            </Button>
                          )}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">Nenhum pedido pendente</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar Pagamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="payAmount">Valor</Label>
              <Input
                id="payAmount"
                type="number"
                step="0.01"
                min="0"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Forma</Label>
              <select
                className="w-full p-2 border rounded-md"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
              >
                <option value="DINHEIRO">Dinheiro</option>
                <option value="DEBITO">Débito</option>
                <option value="CREDITO">Crédito</option>
                <option value="PIX">PIX</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleConfirmPayment}>Confirmar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
