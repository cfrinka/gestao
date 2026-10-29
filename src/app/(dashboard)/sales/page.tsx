"use client";

import { useState, useEffect } from "react";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { auth } from "@/lib/firebase";
import { Eye, Download, Banknote, CreditCard, Smartphone, Printer } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { TotalsStrip } from "@/components/etiqueta/totals-strip";
import { PriceTag } from "@/components/etiqueta/price-tag";
import { addDaysISO, toStoreISODate, todayISO } from "@/lib/dates";

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
  subtotal?: number;
  discount?: number;
  totalAmount: number;
  payments?: PaymentMethod[];
  items: OrderItem[];
  clientId?: string;
  clientName?: string;
  customerPhone?: string;
  isPaidLater?: boolean;
  amountPaid?: number;
  remainingAmount?: number;
  paymentHistory?: FiadoPayment[];
  paidAt?: string;
  isCancelled?: boolean;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  /** Not a sale: money received today against an older fiado sale (see fiado-payment.ts). */
  entryType?: "fiado_payment";
  relatedOrderId?: string;
}

export default function SalesPage() {
  const { toast } = useToast();
  const { userData } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isEditingSale, setIsEditingSale] = useState(false);
  const [savingSaleEdit, setSavingSaleEdit] = useState(false);
  const [cancellingSale, setCancellingSale] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelPassword, setCancelPassword] = useState("");
  const [editDiscount, setEditDiscount] = useState("0");
  const [editPayments, setEditPayments] = useState<Record<PaymentMethod["method"], string>>({
    DINHEIRO: "0",
    DEBITO: "0",
    CREDITO: "0",
    PIX: "0",
  });
  // Opens on the last 30 days ("Tudo" is one tap away): loading every sale ever made by default
  // got slower with each one.
  const [startDate, setStartDate] = useState(() => addDaysISO(todayISO(), -29));
  const [endDate, setEndDate] = useState(() => todayISO());
  const [storeSettings, setStoreSettings] = useState<StoreSettings>({
    storeName: "Gestão Loja",
    address: "",
    phone: "",
    cnpj: "",
    footerMessage: "Obrigado pela preferência!\nVolte sempre!",
    exchangeDays: 10,
  });

  const periodTotalSold = orders.reduce((sum, o) => {
    if (o.isCancelled) return sum;
    if (o.entryType === "fiado_payment") return sum;
    return sum + (typeof o.totalAmount === "number" ? o.totalAmount : 0);
  }, 0);

  const periodFiadoOutstanding = orders.reduce((sum, o) => {
    if (o.isCancelled) return sum;
    if (!o.isPaidLater) return sum;
    if (typeof o.remainingAmount === "number") return sum + o.remainingAmount;
    return sum + (o.paidAt ? 0 : (typeof o.totalAmount === "number" ? o.totalAmount : 0));
  }, 0);

  const canEditSales = userData?.role === "ADMIN";

  useEffect(() => {
    if (!selectedOrder) {
      setIsEditingSale(false);
      return;
    }

    const subtotalFromItems = selectedOrder.items.reduce((sum, item) => sum + Number(item.totalRevenue || 0), 0);
    const initialDiscount =
      typeof selectedOrder.discount === "number"
        ? selectedOrder.discount
        : Math.max(0, subtotalFromItems - Number(selectedOrder.totalAmount || 0));

    const paymentMap: Record<PaymentMethod["method"], string> = {
      DINHEIRO: "0",
      DEBITO: "0",
      CREDITO: "0",
      PIX: "0",
    };

    (selectedOrder.payments || []).forEach((payment) => {
      paymentMap[payment.method] = String(Number(payment.amount || 0));
    });

    setEditDiscount(String(initialDiscount));
    setEditPayments(paymentMap);
    setIsEditingSale(false);
    setCancellingSale(false);
    setCancelReason("");
    setCancelPassword("");
  }, [selectedOrder]);

  // Cash actually received in the period: non-fiado sales count in full (paid on the spot), and
  // fiado sales count only through their "fiado_payment" entries (dated by when the money came
  // in, not by the original sale) — never through the order's own amountPaid, which is its
  // cumulative total as of now and would double-count whatever a fiado_payment entry already adds.
  const periodReceived = orders.reduce((sum, o) => {
    if (o.isCancelled) return sum;
    const total = typeof o.totalAmount === "number" ? o.totalAmount : 0;
    if (o.entryType === "fiado_payment") return sum + total;
    if (o.isPaidLater) return sum;
    return sum + total;
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
      const normalizedOrders: Order[] = Array.isArray(data) ? data : [];
      normalizedOrders.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setOrders(normalizedOrders);
    } catch {
      toast({ title: "Erro ao carregar vendas", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    fetchStoreSettings();
    // Intentionally run once on mount with the default (empty) date range — changing the
    // date fields is applied explicitly via the "Filtrar" button (handleFilter), which reads
    // the current startDate/endDate itself. Including fetchOrders here would make every
    // keystroke in the date fields trigger a refetch instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const toISO = toStoreISODate;

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
      start.setDate(today.getDate() - (days - 1));
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
    a.download = `vendas-${todayISO()}.csv`;
    a.click();
  };

  const handleSaveSaleEdit = async () => {
    if (!selectedOrder) return;
    if (selectedOrder.isCancelled) {
      toast({ title: "Venda cancelada não pode ser editada", variant: "destructive" });
      return;
    }

    const safeDiscount = Number(editDiscount || 0);
    if (!Number.isFinite(safeDiscount) || safeDiscount < 0) {
      toast({ title: "Desconto inválido", variant: "destructive" });
      return;
    }

    const payments: PaymentMethod[] = (Object.keys(editPayments) as PaymentMethod["method"][])
      .map((method) => ({
        method,
        amount: Number(editPayments[method] || 0),
      }))
      .filter((payment) => Number.isFinite(payment.amount) && payment.amount > 0);

    setSavingSaleEdit(true);
    try {
      const updatedOrder = (await apiPatch("/api/orders", {
        orderId: selectedOrder.id,
        discount: safeDiscount,
        payments,
      })) as Order;

      setSelectedOrder(updatedOrder);
      await fetchOrders();
      setIsEditingSale(false);
      toast({ title: "Venda atualizada com sucesso" });
    } catch (error) {
      toast({
        title: "Erro ao atualizar venda",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setSavingSaleEdit(false);
    }
  };

  const handleCancelSale = async () => {
    if (!selectedOrder) return;
    if (selectedOrder.isCancelled) {
      toast({ title: "Venda já cancelada", variant: "destructive" });
      return;
    }

    const firebaseUser = auth.currentUser;
    if (!firebaseUser?.email) {
      toast({ title: "Sessão inválida", description: "Faça login novamente.", variant: "destructive" });
      return;
    }

    const trimmedPassword = cancelPassword.trim();
    if (!trimmedPassword) {
      toast({ title: "Informe a senha para confirmar", variant: "destructive" });
      return;
    }

    setCancellingSale(true);
    try {
      const credential = EmailAuthProvider.credential(firebaseUser.email, trimmedPassword);
      await reauthenticateWithCredential(firebaseUser, credential);
      await firebaseUser.getIdToken(true);

      const updated = (await apiPost("/api/orders", {
        orderId: selectedOrder.id,
        reason: cancelReason.trim(),
      })) as Order;

      setSelectedOrder(updated);
      await fetchOrders();
      setIsEditingSale(false);
      setCancelPassword("");

      toast({ title: "Venda cancelada com sucesso" });
    } catch (error) {
      toast({
        title: "Erro ao cancelar venda",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setCancellingSale(false);
    }
  };

  const paymentLabel = (method: string) =>
    method === "DINHEIRO" ? "Dinheiro" : method === "DEBITO" ? "Débito" : method === "CREDITO" ? "Crédito" : method === "PIX" ? "PIX" : method;

  const renderPayment = (order: (typeof orders)[number]) =>
    order.entryType === "fiado_payment" ? (
      <Badge variant="positive">Recebimento fiado · {paymentLabel(order.payments?.[0]?.method || "")}</Badge>
    ) : order.isPaidLater ? (
      <Badge variant={order.paidAt ? "positive" : "destructive"}>
        {order.paidAt ? "Fiado pago" : `Fiado · ${formatCurrency(order.remainingAmount ?? order.totalAmount)}`}
      </Badge>
    ) : order.payments && order.payments.length > 0 ? (
      <span className="text-sm text-ink-2">{order.payments.map((p) => paymentLabel(p.method)).join(" + ")}</span>
    ) : (
      <span className="text-ink-3">—</span>
    );

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Vendas"
        meta={
          !loading ? (
            <span>
              <b className="font-semibold text-ink">
                {orders.filter((o) => o.entryType !== "fiado_payment").length}
              </b>{" "}
              vendas no período
            </span>
          ) : null
        }
        actions={
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Exportar CSV
          </Button>
        }
        className="mb-0 md:mb-0"
      />

      <div className="space-y-3">
        <div className="-mx-3 flex gap-1.5 scroll-row overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Períodos rápidos">
          {([
            ["today", "Hoje"],
            ["yesterday", "Ontem"],
            ["this_week", "Esta semana"],
            ["this_month", "Este mês"],
            ["last_30", "Últimos 30 dias"],
            ["last_90", "Últimos 90 dias"],
            ["all", "Todo o período"],
          ] as const).map(([preset, label]) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyPreset(preset)}
              className="inline-flex h-9 flex-shrink-0 items-center border border-rule-strong bg-paper px-3 text-sm font-semibold text-ink transition-colors hover:border-ink"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="sales-start" className="text-xs">De</Label>
            <Input
              id="sales-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 w-[160px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sales-end" className="text-xs">Até</Label>
            <Input
              id="sales-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 w-[160px]"
            />
          </div>
          <Button size="sm" onClick={handleFilter}>Filtrar</Button>
          <Button variant="ghost" size="sm" onClick={handleClearFilter}>
            Limpar
          </Button>
        </div>
      </div>

      <TotalsStrip
        items={[
          { label: "Total vendido", value: loading ? "…" : formatCurrency(periodTotalSold) },
          { label: "Fiado a receber", value: loading ? "…" : formatCurrency(periodFiadoOutstanding), tone: !loading && periodFiadoOutstanding > 0 ? "debt" : "neutral" },
          { label: "Recebido", value: loading ? "…" : formatCurrency(periodReceived), tone: "positive" },
        ]}
      />

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse border border-rule bg-paper" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <p className="border border-rule bg-paper px-5 py-12 text-center text-sm text-ink-3">
          Nenhuma venda no período. Escolha outro período acima.
        </p>
      ) : (
        <>
          <div className="hidden border border-rule bg-paper md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Pedido</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Itens</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="pr-4 text-right"><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders?.map((order) => (
                  <TableRow
                    key={order.id}
                    className={order.isCancelled ? "text-ink-3" : order.entryType === "fiado_payment" ? "bg-verde-tint/30" : undefined}
                  >
                    <TableCell className="pl-4 font-semibold">
                      {order.entryType === "fiado_payment" ? (
                        <div className="flex items-center gap-2 text-ink-2">
                          <Banknote className="h-4 w-4" aria-hidden="true" />
                          <span>Pagamento de fiado</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span>#{order.id.slice(-6).toUpperCase()}</span>
                          {order.isCancelled && <Badge variant="destructive">Cancelada</Badge>}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-ink-2">{formatDate(new Date(order.createdAt))}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {order.entryType === "fiado_payment" ? <span className="text-ink-3">—</span> : order.items.length}
                    </TableCell>
                    <TableCell>{renderPayment(order)}</TableCell>
                    <TableCell>
                      {order.clientName || order.customerPhone ? (
                        <span className="text-sm">{order.clientName || order.customerPhone}</span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </TableCell>
                    <TableCell className={cn("text-right font-semibold tabular-nums", order.isCancelled && "line-through")}>
                      {order.isCancelled ? "R$ 0,00" : formatCurrency(order.totalAmount)}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      {order.entryType === "fiado_payment" ? (
                        <span className="text-ink-3">—</span>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => printReceipt(order)}
                            title="Reimprimir cupom"
                            aria-label={`Reimprimir cupom do pedido ${order.id.slice(-6).toUpperCase()}`}
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedOrder(order)}
                            title="Ver detalhes"
                            aria-label={`Ver pedido ${order.id.slice(-6).toUpperCase()}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="divide-y divide-rule border border-rule bg-paper md:hidden">
            {orders?.map((order) => (
              <li key={order.id} className={order.entryType === "fiado_payment" ? "bg-verde-tint/30" : undefined}>
                {order.entryType === "fiado_payment" ? (
                  <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-3 text-left">
                    <span className="flex items-center gap-2 font-semibold text-ink-2">
                      <Banknote className="h-4 w-4" aria-hidden="true" />
                      Pagamento de fiado
                    </span>
                    <span className="text-right font-tag text-xl font-extrabold tabular-nums">
                      {formatCurrency(order.totalAmount)}
                    </span>
                    <span className="text-sm text-ink-3">
                      {formatDate(new Date(order.createdAt))}
                      {order.clientName ? ` · ${order.clientName}` : ""}
                    </span>
                    <span className="text-right">{renderPayment(order)}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSelectedOrder(order)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-3 text-left"
                  >
                    <span className="font-semibold">
                      #{order.id.slice(-6).toUpperCase()}
                      {order.isCancelled ? <Badge variant="destructive" className="ml-2 align-[1px]">Cancelada</Badge> : null}
                    </span>
                    <span className={cn("text-right font-tag text-xl font-extrabold tabular-nums", order.isCancelled && "text-ink-3 line-through")}>
                      {order.isCancelled ? "R$ 0,00" : formatCurrency(order.totalAmount)}
                    </span>
                    <span className="text-sm text-ink-3">
                      {formatDate(new Date(order.createdAt))} · {order.items.length} {order.items.length === 1 ? "item" : "itens"}
                      {order.clientName || order.customerPhone ? ` · ${order.clientName || order.customerPhone}` : ""}
                    </span>
                    <span className="text-right">{renderPayment(order)}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Pedido #{selectedOrder?.id.slice(-6).toUpperCase()}
            </DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="flex items-end justify-between gap-3 border-b-[1.5px] border-dashed border-rule-strong pb-3">
                <span className="text-sm text-ink-2">
                  {formatDate(new Date(selectedOrder.createdAt))}
                  {selectedOrder.customerPhone ? <span className="block">Cliente: {selectedOrder.customerPhone}</span> : null}
                </span>
                <span className={selectedOrder.isCancelled ? "text-ink-3 line-through" : undefined}>
                  <PriceTag value={selectedOrder.isCancelled ? 0 : selectedOrder.totalAmount} className="text-[32px]" />
                </span>
              </div>

              {selectedOrder.isCancelled && (
                <div className="space-y-1 border border-vermelho/30 bg-vermelho-tint p-3 text-sm text-vermelho">
                  <p className="font-medium">Venda cancelada</p>
                  <p>
                    Motivo: {selectedOrder.cancellationReason || "Sem motivo informado"}
                  </p>
                  {selectedOrder.cancelledAt && (
                    <p>Cancelada em: {formatDate(new Date(selectedOrder.cancelledAt))}</p>
                  )}
                </div>
              )}

              {canEditSales && !selectedOrder.isPaidLater && !selectedOrder.isCancelled && (
                <div className="space-y-3 border border-rule p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">Corrigir venda <span className="font-normal text-ink-3">· administrador</span></p>
                    {!isEditingSale ? (
                      <Button variant="outline" size="sm" onClick={() => setIsEditingSale(true)}>
                        Editar venda
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsEditingSale(false)}
                        disabled={savingSaleEdit}
                      >
                        Cancelar
                      </Button>
                    )}
                  </div>

                  {isEditingSale && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Desconto</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editDiscount}
                          onChange={(e) => setEditDiscount(e.target.value)}
                        />
                      </div>

                      {(Object.keys(editPayments) as PaymentMethod["method"][]).map((method) => (
                        <div key={method} className="space-y-1">
                          <Label>
                            {method === "DINHEIRO" && "Dinheiro"}
                            {method === "DEBITO" && "Débito"}
                            {method === "CREDITO" && "Crédito"}
                            {method === "PIX" && "PIX"}
                          </Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editPayments[method]}
                            onChange={(e) =>
                              setEditPayments((current) => ({
                                ...current,
                                [method]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      ))}

                      <div className="sm:col-span-2 flex justify-end">
                        <Button onClick={handleSaveSaleEdit} disabled={savingSaleEdit}>
                          {savingSaleEdit ? "Salvando…" : "Salvar correções"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {canEditSales &&
                !selectedOrder.isCancelled &&
                (!selectedOrder.isPaidLater || !(Number(selectedOrder.amountPaid || 0) > 0)) && (
                <div className="space-y-3 border border-vermelho/30 bg-vermelho-tint p-3">
                  <p className="text-sm font-semibold text-vermelho">Cancelar venda <span className="font-normal">· administrador</span></p>
                  <p className="text-xs text-vermelho">
                    {selectedOrder.isPaidLater
                      ? "O cancelamento mantém o histórico da venda, devolve as peças ao estoque e tira o valor do saldo do cliente e dos relatórios."
                      : "O cancelamento mantém o histórico da venda, mas remove o impacto dela dos números de caixa e relatórios."}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1 sm:col-span-2">
                      <Label>Motivo do cancelamento</Label>
                      <Input
                        placeholder="Ex.: venda lançada em duplicidade"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label>Senha do administrador</Label>
                      <Input
                        type="password"
                        placeholder="Digite sua senha para confirmar"
                        value={cancelPassword}
                        onChange={(e) => setCancelPassword(e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2 flex justify-end">
                      <Button variant="destructive" onClick={handleCancelSale} disabled={cancellingSale}>
                        {cancellingSale ? "Cancelando…" : "Cancelar venda"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {selectedOrder.isPaidLater && (
                <div className={`border p-3 ${selectedOrder.paidAt ? 'border-verde/30 bg-verde-tint' : 'border-vermelho/30 bg-vermelho-tint'}`}>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className={`font-semibold ${selectedOrder.paidAt ? 'text-verde' : 'text-vermelho'}`}>
                        {selectedOrder.paidAt ? 'Venda no fiado · paga' : 'Venda no fiado · em aberto'}
                      </p>
                      <p className="text-sm text-ink-2">Cliente: {selectedOrder.clientName}</p>
                      <p className="text-xs text-ink-2">
                        Pago {formatCurrency(selectedOrder.amountPaid || 0)} · falta {formatCurrency(selectedOrder.remainingAmount ?? selectedOrder.totalAmount)}
                      </p>
                    </div>
                    {selectedOrder.paidAt && (
                      <p className="text-xs text-verde">
                        Quitado em {formatDate(new Date(selectedOrder.paidAt))}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {selectedOrder.isPaidLater && selectedOrder.paymentHistory && selectedOrder.paymentHistory.length > 0 && (
                <div>
                  <h4 className="mb-2 font-tag text-base font-bold uppercase tracking-[0.06em] text-ink-2">Pagamentos recebidos</h4>
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
                  <h4 className="mb-2 font-tag text-base font-bold uppercase tracking-[0.06em] text-ink-2">Formas de pagamento</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedOrder.payments.map((payment, index) => (
                      <div key={index} className="flex items-center gap-2 border border-rule bg-sub p-2">
                        {payment.method === "DINHEIRO" && <Banknote className="h-4 w-4 text-ink-2" />}
                        {payment.method === "DEBITO" && <CreditCard className="h-4 w-4 text-ink-2" />}
                        {payment.method === "CREDITO" && <CreditCard className="h-4 w-4 text-ink-2" />}
                        {payment.method === "PIX" && <Smartphone className="h-4 w-4 text-ink-2" />}
                        <span className="text-sm">
                          {payment.method === "DINHEIRO" && "Dinheiro"}
                          {payment.method === "DEBITO" && "Débito"}
                          {payment.method === "CREDITO" && "Crédito"}
                          {payment.method === "PIX" && "PIX"}
                        </span>
                        <span className="ml-auto font-semibold tabular-nums">{formatCurrency(payment.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h4 className="mb-2 font-tag text-base font-bold uppercase tracking-[0.06em] text-ink-2">Itens</h4>
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
                    {selectedOrder.items?.map((item) => (
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
                  <Printer className="h-4 w-4" aria-hidden="true" />
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
