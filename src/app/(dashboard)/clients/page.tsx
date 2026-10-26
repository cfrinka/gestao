"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { apiGet, apiPost, apiPut, apiDelete, apiPatch } from "@/lib/api-client";
import { formatPhone, isValidPhone } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { cn, formatCurrency } from "@/lib/utils";
import { Plus, Pencil, Trash2, CreditCard, Eye, Printer, X, Search, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StateTag } from "@/components/layout/page-header";
import { PriceTag } from "@/components/etiqueta/price-tag";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface FiadoPaymentEntry {
  id: string;
  amount: number;
  method: string;
  createdAt: string;
  receivedByUserName?: string;
}

interface Order {
  id: string;
  totalAmount: number;
  createdAt: string;
  amountPaid?: number;
  remainingAmount?: number;
  items?: OrderItem[];
  paymentHistory?: FiadoPaymentEntry[];
}

interface OrderItem {
  id: string;
  productName?: string;
  size?: string;
  quantity: number;
}

interface PaymentAllocation {
  orderId: string;
  orderDate: string;
  orderTotalAmount: number;
  remainingBefore: number;
  appliedAmount: number;
  remainingAfter: number;
  isFullyPaid: boolean;
}

interface FiadoPaymentResult {
  allocations: PaymentAllocation[];
  totalApplied: number;
  overpayment: number;
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
  const { confirm, confirmDialog } = useConfirm();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [onlyOwing, setOnlyOwing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [removingOrderItemId, setRemovingOrderItemId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"DINHEIRO" | "DEBITO" | "CREDITO" | "PIX">("DINHEIRO");
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  // One key per attempted receipt: a double tap, or Confirmar pressed again after a dropped
  // response, reaches the server with the same key and is recorded once. Changing the amount or
  // the method makes it a different receipt, with a new key.
  const paymentAttempt = useRef<{ key: string; signature: string } | null>(null);
  const [lastPaymentResult, setLastPaymentResult] = useState<FiadoPaymentResult | null>(null);
  const [debtCorrectionDialogOpen, setDebtCorrectionDialogOpen] = useState(false);
  const [correctionAmount, setCorrectionAmount] = useState<string>("");
  const [correctionReason, setCorrectionReason] = useState<string>("");
  const [adminPassword, setAdminPassword] = useState<string>("");
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    notes: "",
  });

  const fetchClients = useCallback(async () => {
    try {
      const data = await apiGet("/api/clients");
      setClients(Array.isArray(data) ? data : []);
    } catch {
      toast({ title: "Erro ao carregar clientes", variant: "destructive" });
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const handleRemoveOrderItem = async (orderId: string, orderItemId: string) => {
    if (!selectedClient) return;

    const confirmed = await confirm({
      title: "Remover este item da venda?",
      description: "A peça volta para o estoque e o saldo do cliente é recalculado.",
      confirmLabel: "Remover item",
      danger: true,
    });
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
  }, [fetchClients]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isValidPhone(formData.phone)) {
      toast({
        title: "Informe o celular com DDD",
        description: "Ele é usado para lembrar o cliente do fiado pelo WhatsApp.",
        variant: "destructive",
      });
      return;
    }

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
    if (!(await confirm({ title: "Excluir este cliente?", confirmLabel: "Excluir", danger: true }))) return;

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

  const openPaymentDialog = () => {
    if (!selectedClient) return;
    setPaymentAmount("");
    setPaymentMethod("DINHEIRO");
    paymentAttempt.current = null;
    setPaymentDialogOpen(true);
  };

  const openDebtCorrectionDialog = () => {
    if (!selectedClient) return;
    setCorrectionAmount(selectedClient.balance > 0 ? selectedClient.balance.toFixed(2) : "");
    setCorrectionReason("");
    setAdminPassword("");
    setDebtCorrectionDialogOpen(true);
  };

  const handleConfirmDebtCorrection = async () => {
    if (!selectedClient) return;

    const parsedAmount = parseFloat(correctionAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
      toast({ title: "Informe um valor válido diferente de zero", variant: "destructive" });
      return;
    }

    if (!correctionReason.trim()) {
      toast({ title: "Informe o motivo da correção", variant: "destructive" });
      return;
    }

    if (!adminPassword.trim()) {
      toast({ title: "Informe a senha de administrador", variant: "destructive" });
      return;
    }

    try {
      const updated = await apiPatch(`/api/clients/${selectedClient.id}`, {
        action: "correct_debt",
        amount: parsedAmount,
        reason: correctionReason.trim(),
        adminPassword: adminPassword.trim(),
      });
      setSelectedClient({ ...updated, pendingOrders: updated.pendingOrders || [] });

      const isReduction = parsedAmount < 0;
      toast({
        title: `Correção aplicada com sucesso!`,
        description: isReduction
          ? `Débito reduzido em ${formatCurrency(Math.abs(parsedAmount))}`
          : `Saldo ajustado em ${formatCurrency(parsedAmount)}`
      });

      setDebtCorrectionDialogOpen(false);
      fetchClients();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao aplicar correção";
      toast({ title: message, variant: "destructive" });
    }
  };

  const handleConfirmPayment = async () => {
    if (!selectedClient) return;

    const parsed = parseFloat(paymentAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({ title: "Informe um valor válido", variant: "destructive" });
      return;
    }

    if (parsed > selectedClient.balance + 0.01) {
      toast({ title: "Valor maior que o débito do cliente", variant: "destructive" });
      return;
    }

    if (submittingPayment) return;
    setSubmittingPayment(true);
    const signature = `${selectedClient.id}|${parsed}|${paymentMethod}`;
    if (paymentAttempt.current?.signature !== signature) {
      paymentAttempt.current = { key: crypto.randomUUID(), signature };
    }
    try {
      const updated = await apiPatch(`/api/clients/${selectedClient.id}`, {
        action: "pay_cascading",
        amount: parsed,
        method: paymentMethod,
        idempotencyKey: paymentAttempt.current.key,
      });
      setSelectedClient({ ...updated, pendingOrders: updated.pendingOrders || [] });
      setLastPaymentResult(updated.paymentResult);

      const result = updated.paymentResult as FiadoPaymentResult;
      let message = `Pagamento de ${formatCurrency(result.totalApplied)} registrado!`;

      if (result.allocations.length > 1) {
        message += ` Distribuído em ${result.allocations.length} pedidos.`;
      } else if (result.allocations.length === 1) {
        const allocation = result.allocations[0];
        message += allocation.isFullyPaid ? " Pedido quitado." : " Pagamento parcial.";
      }

      toast({ title: message });
      setPaymentDialogOpen(false);
      fetchClients();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao registrar pagamento";
      toast({ title: message, variant: "destructive" });
    } finally {
      setSubmittingPayment(false);
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

  const isAdmin = userData?.role === "ADMIN";
  const totalPending = clients.reduce((sum, c) => sum + c.balance, 0);
  const owingCount = clients.filter((c) => c.balance > 0.009).length;
  const normalizedSearch = search.trim().toLowerCase();
  const visibleClients = clients.filter((c) => {
    if (onlyOwing && !(c.balance > 0.009)) return false;
    if (!normalizedSearch) return true;
    return (
      c.name.toLowerCase().includes(normalizedSearch) ||
      (c.phone || "").toLowerCase().includes(normalizedSearch) ||
      (c.email || "").toLowerCase().includes(normalizedSearch)
    );
  });

  return (
    <div>
      {confirmDialog}
      <PageHeader
        title="Clientes e fiado"
        meta={
          !loading ? (
            <>
              <span>
                <b className="font-semibold text-ink">{clients.length}</b> clientes
              </span>
              {totalPending > 0.009 ? (
                <StateTag tone="debt">
                  {formatCurrency(totalPending)} a receber · {owingCount} {owingCount === 1 ? "conta" : "contas"}
                </StateTag>
              ) : (
                <StateTag tone="open">Nenhum fiado em aberto</StateTag>
              )}
            </>
          ) : null
        }
        actions={
          isAdmin ? (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openNewDialog}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Novo cliente
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingClient ? "Editar cliente" : "Novo cliente"}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Celular com DDD</Label>
                    <Input
                      id="phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="(11) 98765-4321"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      onBlur={() => setFormData((current) => ({ ...current, phone: formatPhone(current.phone) }))}
                      aria-invalid={formData.phone.trim() !== "" && !isValidPhone(formData.phone)}
                      aria-describedby="phone-hint"
                      required
                    />
                    <p id="phone-hint" className={formData.phone.trim() !== "" && !isValidPhone(formData.phone) ? "text-xs text-vermelho" : "text-xs text-ink-3"}>
                      {formData.phone.trim() !== "" && !isValidPhone(formData.phone)
                        ? "Número incompleto: confira o DDD e os dígitos."
                        : "Obrigatório: é por ele que o lembrete do fiado chega no WhatsApp."}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">E-mail</Label>
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
                <div className="flex gap-2 border-t border-rule pt-4">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" className="flex-1">
                    {editingClient ? "Salvar alterações" : "Cadastrar cliente"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
          ) : null
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou e-mail"
            aria-label="Buscar cliente"
            className="pl-9"
          />
        </div>
        <div className="inline-flex self-start border-[1.5px] border-ink" role="group" aria-label="Filtrar clientes">
          <button
            type="button"
            aria-pressed={!onlyOwing}
            onClick={() => setOnlyOwing(false)}
            className={cn("h-9 px-3 text-sm font-semibold transition-colors", !onlyOwing ? "bg-ink text-white" : "bg-paper hover:bg-sub")}
          >
            Todos
          </button>
          <button
            type="button"
            aria-pressed={onlyOwing}
            onClick={() => setOnlyOwing(true)}
            className={cn("h-9 border-l-[1.5px] border-ink px-3 text-sm font-semibold transition-colors", onlyOwing ? "bg-ink text-white" : "bg-paper hover:bg-sub")}
          >
            Com fiado · {owingCount}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse border border-rule bg-paper" />
          ))}
        </div>
      ) : visibleClients.length === 0 ? (
        <div className="border border-rule bg-paper px-6 py-14 text-center">
          <p className="font-semibold text-ink">
            {clients.length === 0
              ? "Nenhum cliente cadastrado"
              : onlyOwing && !normalizedSearch
              ? "Ninguém está devendo agora"
              : `Nenhum cliente com “${search.trim()}”`}
          </p>
          {clients.length === 0 ? (
            <p className="mt-1 text-sm text-ink-3">Clientes cadastrados podem comprar fiado no PDV.</p>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y divide-rule border border-rule bg-paper">
          {visibleClients.map((client) => {
            const owes = client.balance > 0.009;
            return (
              <li key={client.id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                <button
                  type="button"
                  onClick={() => handleViewDetails(client)}
                  className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 text-left md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_150px]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{client.name}</span>
                    <span className="block truncate text-sm text-ink-3 md:hidden">
                      {isValidPhone(client.phone) ? client.phone : <span className="text-vermelho">Sem celular válido</span>}
                    </span>
                  </span>
                  <span className="hidden truncate text-sm text-ink-2 md:block">
                    {isValidPhone(client.phone) ? client.phone : <span className="text-vermelho">Sem celular válido</span>}
                  </span>
                  <span className="hidden truncate text-sm text-ink-2 md:block">{client.email || "—"}</span>
                  <span className="text-right">
                    {owes ? (
                      <span className="text-vermelho">
                        <PriceTag value={client.balance} className="text-xl" />
                        <span className="block text-xs font-semibold">deve</span>
                      </span>
                    ) : (
                      <span className="text-sm font-semibold text-verde">Em dia</span>
                    )}
                  </span>
                </button>
                <div className="flex flex-shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleViewDetails(client)}
                    aria-label={`Ver conta de ${client.name}`}
                    title="Ver conta"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(client)}
                      aria-label={`Editar ${client.name}`}
                      title="Editar"
                      className="hidden sm:inline-flex"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(client.id)}
                      className="hidden hover:bg-vermelho-tint hover:text-vermelho sm:inline-flex"
                      aria-label={`Excluir ${client.name}`}
                      title="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Client Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conta do cliente</DialogTitle>
          </DialogHeader>
          {selectedClient && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b-[1.5px] border-dashed border-rule-strong pb-4">
                <div className="min-w-0">
                  <p className="text-lg font-bold leading-snug">{selectedClient.name}</p>
                  <p className="text-sm text-ink-3">
                    {[selectedClient.phone, selectedClient.email].filter(Boolean).join(" · ") || "Sem contato cadastrado"}
                  </p>
                  {selectedClient.notes && (
                    <p className="mt-2 max-w-prose text-sm text-ink-2">{selectedClient.notes}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">Saldo devedor</p>
                  <div className={selectedClient.balance > 0.009 ? "text-vermelho" : "text-verde"}>
                    <PriceTag value={selectedClient.balance} className="text-[36px]" />
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-4 flex flex-wrap gap-2">
                  {selectedClient.balance > 0.009 && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={openPaymentDialog}
                    >
                      <CreditCard className="h-4 w-4" aria-hidden="true" />
                      Receber pagamento
                    </Button>
                  )}
                  {isAdmin && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={openDebtCorrectionDialog}
                  >
                    Corrigir débito
                  </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => printClientDebtDetails(selectedClient)}
                  >
                    <Printer className="h-4 w-4" aria-hidden="true" />
                    Imprimir 80 mm
                  </Button>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDetailsOpen(false);
                        handleEdit(selectedClient);
                      }}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      Editar
                    </Button>
                  )}
                </div>
                <h3 className="mb-2 font-tag text-base font-bold uppercase tracking-[0.06em] text-ink-2">
                  Compras no fiado
                </h3>
                {selectedClient.pendingOrders && selectedClient.pendingOrders.length > 0 ? (
                  <div className="space-y-2">
                    {selectedClient.pendingOrders.map((order) => {
                      const remaining = typeof order.remainingAmount === "number" ? order.remainingAmount : order.totalAmount;
                      const paid = typeof order.amountPaid === "number" ? order.amountPaid : 0;
                      const isFullyPaid = remaining <= 0;
                      const hasPartialPayment = paid > 0 && !isFullyPaid;
                      return (
                      <div key={order.id} className="flex items-start justify-between gap-3 border border-rule bg-paper p-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold">Pedido #{order.id.slice(-6).toUpperCase()}</p>
                            {isFullyPaid ? (
                              <Badge variant="positive">Pago</Badge>
                            ) : hasPartialPayment ? (
                              <Badge variant="outline">Parcial</Badge>
                            ) : (
                              <Badge variant="destructive">Pendente</Badge>
                            )}
                          </div>
                          <p className="text-xs text-ink-3">
                            {new Date(order.createdAt).toLocaleDateString("pt-BR")}
                          </p>
                          <p className="text-xs text-ink-2">
                            Pago {formatCurrency(paid)}{isFullyPaid ? '' : ` · falta ${formatCurrency(remaining)}`}
                          </p>
                          {order.paymentHistory && order.paymentHistory.length > 0 && (
                            <div className="pt-1">
                              <p className="text-xs font-medium text-ink-2">Pagamentos:</p>
                              <ul className="text-xs text-ink-2 space-y-0.5">
                                {order.paymentHistory.map((entry) => (
                                  <li key={entry.id} className="flex items-center gap-2">
                                    <span className="text-verde font-medium">{formatCurrency(entry.amount)}</span>
                                    <span className="text-ink-3">•</span>
                                    <span>{new Date(entry.createdAt).toLocaleDateString("pt-BR")} {new Date(entry.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                                    {entry.receivedByUserName && (
                                      <>
                                        <span className="text-ink-3">•</span>
                                        <span className="text-ink-3">recebido por {entry.receivedByUserName}</span>
                                      </>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {order.items && order.items.length > 0 && (
                            <div className="pt-1">
                              <p className="text-xs font-medium text-ink-2">Itens comprados:</p>
                              <ul className="text-xs text-ink-2 space-y-1">
                                {order.items.map((item) => (
                                  <li key={item.id} className="flex items-center justify-between gap-2">
                                    <span>
                                      {item.quantity}x {item.productName || "Produto removido"}
                                      {item.size ? ` (${item.size})` : ""}
                                    </span>
                                    {isAdmin && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-vermelho"
                                      title="Remover item"
                                      disabled={removingOrderItemId === item.id || isFullyPaid}
                                      onClick={() => handleRemoveOrderItem(order.id, item.id)}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </Button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`font-tag text-xl font-extrabold tabular-nums ${isFullyPaid ? 'text-verde' : 'text-vermelho'}`}>
                            {isFullyPaid ? formatCurrency(paid) : formatCurrency(remaining)}
                          </span>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="border border-rule bg-sub p-4 text-sm text-ink-3">Nenhuma compra no fiado em aberto.</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Receber pagamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {selectedClient && (
              <div className="flex items-end justify-between border-b-[1.5px] border-dashed border-rule-strong pb-3">
                <span className="pb-1 text-sm text-ink-2">{selectedClient.name} deve</span>
                <span className="text-vermelho"><PriceTag value={selectedClient.balance} className="text-[32px]" /></span>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="payAmount">Valor recebido</Label>
              <Input
                id="payAmount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                max={selectedClient?.balance || undefined}
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="0,00"
                className="h-12 text-right text-lg font-semibold tabular-nums"
              />
              {selectedClient && selectedClient.balance > 0.009 && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  onClick={() => setPaymentAmount(selectedClient.balance.toFixed(2))}
                >
                  Receber tudo ({formatCurrency(selectedClient.balance)})
                </Button>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="payMethod">Forma de pagamento</Label>
              <select
                id="payMethod"
                className="h-10 w-full border border-input bg-paper px-3 text-sm text-ink focus-visible:border-denim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-denim"
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
              <Button onClick={handleConfirmPayment} disabled={submittingPayment}>
                {submittingPayment ? "Registrando…" : "Confirmar recebimento"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {lastPaymentResult && (
        <Dialog open={!!lastPaymentResult} onOpenChange={() => setLastPaymentResult(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Pagamento recebido</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="border border-verde/30 bg-verde-tint p-4">
                <p className="font-semibold text-verde">
                  Total aplicado: {formatCurrency(lastPaymentResult.totalApplied)}
                </p>
                {lastPaymentResult.overpayment > 0 && (
                  <p className="mt-1 text-sm font-semibold text-ink">
                    Sobra a ser devolvida: {formatCurrency(lastPaymentResult.overpayment)}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-ink-2">Como o valor foi distribuído</h4>
                {lastPaymentResult.allocations.map((allocation) => (
                  <div key={allocation.orderId} className="border border-rule bg-paper p-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-sm">
                          Pedido #{allocation.orderId.slice(-6).toUpperCase()}
                        </p>
                        <p className="text-xs text-ink-3">
                          {allocation.orderDate} • {formatCurrency(allocation.orderTotalAmount)}
                        </p>
                        <p className="text-xs text-ink-2 mt-1">
                          Restava: {formatCurrency(allocation.remainingBefore)} →
                          Aplicado: {formatCurrency(allocation.appliedAmount)} →
                          {allocation.isFullyPaid ?
                            <span className="text-verde font-medium"> Quitado</span> :
                            <span> Resta: {formatCurrency(allocation.remainingAfter)}</span>
                          }
                        </p>
                      </div>
                      <Badge variant={allocation.isFullyPaid ? "positive" : "outline"}>
                        {allocation.isFullyPaid ? "Pago" : "Parcial"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <Button onClick={() => setLastPaymentResult(null)}>
                  Entendido
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={debtCorrectionDialogOpen} onOpenChange={setDebtCorrectionDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Corrigir débito</DialogTitle>
            <p className="text-sm text-ink-3">
              Use esta função para corrigir erros de lançamento. Esta operação não afeta o caixa ou relatórios financeiros.
            </p>
          </DialogHeader>
          <div className="space-y-4">
            <p className="flex gap-2 border border-vermelho/30 bg-vermelho-tint p-3 text-sm text-vermelho">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>Só para corrigir lançamentos errados. Não registra dinheiro no caixa e fica gravada em Correções de débito.</span>
            </p>

            <div className="space-y-2">
              <Label htmlFor="correctionAmount">Valor da correção (R$)</Label>
              <Input
                id="correctionAmount"
                type="number"
                step="0.01"
                value={correctionAmount}
                onChange={(e) => setCorrectionAmount(e.target.value)}
                placeholder="Ex.: −50,00"
              />
              <p className="text-xs text-ink-3">
                Negativo reduz o que o cliente deve; positivo aumenta.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="correctionReason">Motivo</Label>
              <Textarea
                id="correctionReason"
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="O que estava errado e por quê"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="adminPassword">Senha do administrador</Label>
              <Input
                id="adminPassword"
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDebtCorrectionDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmDebtCorrection}
                disabled={!correctionAmount || !correctionReason.trim() || !adminPassword.trim()}
              >
                Aplicar correção
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
