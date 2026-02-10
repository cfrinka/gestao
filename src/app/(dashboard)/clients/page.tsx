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
import { Plus, Pencil, Trash2, Users, CreditCard, Eye, RefreshCw } from "lucide-react";

interface Order {
  id: string;
  totalAmount: number;
  createdAt: string;
  amountPaid?: number;
  remainingAmount?: number;
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
  const [migratingFiado, setMigratingFiado] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
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
    } catch (error) {
      toast({ title: "Erro ao carregar clientes", variant: "destructive" });
      setClients([]);
    } finally {
      setLoading(false);
    }
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
    } catch (error) {
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
    } catch (error) {
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

  const handleMigrateFiado = async () => {
    if (migratingFiado) return;

    try {
      setMigratingFiado(true);

      const dryRun = await apiPost("/api/admin/migrate-fiado", { apply: false, limit: 200 });
      const toUpdate = typeof dryRun?.toUpdate === "number" ? dryRun.toUpdate : 0;

      if (toUpdate <= 0) {
        toast({ title: "Migração FIADO", description: "Nenhum pedido para atualizar." });
        return;
      }

      const ok = confirm(
        `Migração FIADO: ${toUpdate} pedido(s) serão atualizados.\n\nDeseja aplicar agora?`
      );
      if (!ok) return;

      const applied = await apiPost("/api/admin/migrate-fiado", { apply: true, limit: 200 });
      const updated = typeof applied?.updated === "number" ? applied.updated : 0;
      const errors = typeof applied?.errors === "number" ? applied.errors : 0;

      toast({
        title: "Migração FIADO concluída",
        description: `Atualizados: ${updated}. Erros: ${errors}.`,
      });

      if (detailsOpen && selectedClient) {
        const refreshed = await apiGet(`/api/clients/${selectedClient.id}`);
        setSelectedClient(refreshed);
      }
      fetchClients();
    } catch (error) {
      toast({
        title: "Erro na migração FIADO",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setMigratingFiado(false);
    }
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
          <Button variant="outline" onClick={handleMigrateFiado} disabled={migratingFiado}>
            <RefreshCw className={`h-4 w-4 mr-2 ${migratingFiado ? "animate-spin" : ""}`} />
            Migrar FIADO
          </Button>
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
                <p className="text-sm font-medium text-gray-700 mb-2">Pedidos Pendentes</p>
                {selectedClient.pendingOrders && selectedClient.pendingOrders.length > 0 ? (
                  <div className="space-y-2">
                    {selectedClient.pendingOrders.map((order) => {
                      const remaining = typeof order.remainingAmount === "number" ? order.remainingAmount : order.totalAmount;
                      const paid = typeof order.amountPaid === "number" ? order.amountPaid : 0;
                      return (
                      <div key={order.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <p className="text-sm font-medium">Pedido #{order.id.slice(-6).toUpperCase()}</p>
                          <p className="text-xs text-gray-500">
                            {new Date(order.createdAt).toLocaleDateString("pt-BR")}
                          </p>
                          <p className="text-xs text-gray-600">
                            Pago: {formatCurrency(paid)} | Restante: {formatCurrency(remaining)}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-red-600">{formatCurrency(remaining)}</span>
                          <Button size="sm" onClick={() => openPayDialog(order)}>
                            Receber
                          </Button>
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
