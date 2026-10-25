"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { Check, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { TotalsStrip } from "@/components/etiqueta/totals-strip";
import { currentMonthISO, todayISO } from "@/lib/dates";
import { useConfirm } from "@/components/ui/confirm-dialog";

type BillStatus = "PENDING" | "PAID";

type Bill = {
  id: string;
  name: string;
  amount: number;
  dueDate: { _seconds: number; _nanoseconds: number } | string;
  status: BillStatus;
  kind: "FIXED" | "ONE_TIME" | "INSTALLMENT";
  groupId?: string;
  installmentNumber?: number;
  installmentsCount?: number;
  paidAt?: { _seconds: number; _nanoseconds: number } | string | null;
  paidMethod?: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX" | null;
};

type StoreReport = {
  profit: number;
};

function tsToDate(value: Bill["dueDate"]): Date {
  if (typeof value === "string") return new Date(value);
  if (value && typeof value === "object" && "_seconds" in value) {
    return new Date(value._seconds * 1000);
  }
  return new Date(0);
}

function formatDateBR(d: Date) {
  return d.toLocaleDateString("pt-BR");
}

export default function BillsPage() {
  const { userData } = useAuth();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState<Bill[]>([]);
  const [month, setMonth] = useState(() => currentMonthISO());
  const [status, setStatus] = useState<"all" | "pending" | "paid">("pending");

  const [report, setReport] = useState<StoreReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<"FIXED" | "ONE_TIME" | "INSTALLMENTS">("ONE_TIME");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>(() => todayISO());
  const [dayOfMonth, setDayOfMonth] = useState<string>("5");
  const [monthsAhead, setMonthsAhead] = useState<string>("12");
  const [firstDueDate, setFirstDueDate] = useState<string>(() => todayISO());
  const [installmentsCount, setInstallmentsCount] = useState<string>("3");

  const fetchBills = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet(`/api/bills?month=${encodeURIComponent(month)}&status=${encodeURIComponent(status)}`);
      setBills(Array.isArray(data) ? data : []);
    } catch {
      toast({ title: "Erro ao carregar contas", variant: "destructive" });
      setBills([]);
    } finally {
      setLoading(false);
    }
  }, [month, status, toast]);

  const fetchReport = useCallback(async () => {
    setReportLoading(true);
    try {
      if (!/^\d{4}-\d{2}$/.test(month)) {
        setReport(null);
        return;
      }
      const [y, m] = month.split("-").map((v) => parseInt(v, 10));
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 1);

      const data = await apiGet(
        `/api/reports?startDate=${encodeURIComponent(start.toISOString())}&endDate=${encodeURIComponent(end.toISOString())}`
      );
      setReport({ profit: typeof data?.profit === "number" ? data.profit : 0 });
    } catch {
      setReport(null);
      toast({ title: "Erro ao carregar lucro do mês", variant: "destructive" });
    } finally {
      setReportLoading(false);
    }
  }, [month, toast]);

  useEffect(() => {
    if (userData?.role === "ADMIN") {
      fetchBills();
      fetchReport();
    }
  }, [month, status, userData?.role, fetchBills, fetchReport]);

  const totals = useMemo(() => {
    const pending = bills.filter((b) => b.status === "PENDING").reduce((s, b) => s + (b.amount || 0), 0);
    const paid = bills.filter((b) => b.status === "PAID").reduce((s, b) => s + (b.amount || 0), 0);
    return { pending, paid };
  }, [bills]);

  // Paying a bill asks how it was paid in a dialog; closing it pays nothing (the old prompt()
  // marked the bill paid in cash even when cancelled).
  const [payingBill, setPayingBill] = useState<{ id: string; name: string } | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);

  const handleMarkPaid = async (method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX") => {
    if (!payingBill || savingPayment) return;
    setSavingPayment(true);
    try {
      await apiPatch(`/api/bills/${payingBill.id}`, { action: "mark_paid", method });
      toast({ title: "Conta marcada como paga" });
      setPayingBill(null);
      fetchBills();
    } catch (error) {
      toast({
        title: "Erro ao atualizar conta",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSavingPayment(false);
    }
  };

  const handleDelete = async (billId: string) => {
    if (!(await confirm({ title: "Excluir esta conta?", confirmLabel: "Excluir", danger: true }))) return;
    try {
      await apiDelete(`/api/bills/${billId}`);
      toast({ title: "Conta excluída" });
      fetchBills();
    } catch {
      toast({ title: "Erro ao excluir conta", variant: "destructive" });
    }
  };

  const handleCreate = async () => {
    const parsed = parseFloat(amount);
    if (!name.trim()) {
      toast({ title: "Informe o nome", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({ title: "Informe um valor válido", variant: "destructive" });
      return;
    }

    setCreating(true);
    const idempotencyKey = crypto.randomUUID();
    try {
      if (kind === "ONE_TIME") {
        await apiPost("/api/bills", { kind: "ONE_TIME", name: name.trim(), amount: parsed, dueDate, idempotencyKey });
      } else if (kind === "FIXED") {
        await apiPost("/api/bills", {
          kind: "FIXED",
          name: name.trim(),
          amount: parsed,
          dayOfMonth: parseInt(dayOfMonth, 10),
          monthsAhead: parseInt(monthsAhead, 10),
          startMonth: month,
          idempotencyKey,
        });
      } else {
        await apiPost("/api/bills", {
          kind: "INSTALLMENTS",
          name: name.trim(),
          amount: parsed,
          firstDueDate,
          installmentsCount: parseInt(installmentsCount, 10),
          intervalMonths: 1,
          idempotencyKey,
        });
      }

      toast({ title: "Conta(s) criada(s)" });
      setName("");
      setAmount("");
      fetchBills();
    } catch (error) {
      toast({ title: "Erro ao criar conta", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  if (userData?.role !== "ADMIN") {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-ink-3">Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  return (
    <div>
      <Dialog open={payingBill !== null} onOpenChange={(open) => (!open && !savingPayment ? setPayingBill(null) : undefined)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Como foi paga?</DialogTitle>
            {payingBill ? <DialogDescription>{payingBill.name}</DialogDescription> : null}
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {([
              ["DINHEIRO", "Dinheiro"],
              ["PIX", "PIX"],
              ["DEBITO", "Débito"],
              ["CREDITO", "Crédito"],
            ] as const).map(([method, label]) => (
              <Button key={method} variant="outline" className="h-11" disabled={savingPayment} onClick={() => handleMarkPaid(method)}>
                {label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <PageHeader title="Contas" meta={<span>Despesas e contas a pagar da loja</span>} />
      {confirmDialog}

      <TotalsStrip
        className="mb-4 md:mb-6"
        items={[
          { label: "Lucro do mês", value: reportLoading ? "…" : formatCurrency(report?.profit || 0), tone: "positive" },
          { label: "A pagar no mês", value: formatCurrency(totals.pending), tone: totals.pending > 0 ? "debt" : "neutral" },
          { label: "Pago no mês", value: formatCurrency(totals.paid), tone: "positive" },
        ]}
      />

      <div className="grid gap-4 md:gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="border border-rule bg-paper" aria-labelledby="bills-title">
          <div className="flex flex-wrap items-end gap-3 border-b border-rule px-4 py-3">
            <h2 id="bills-title" className="mr-auto font-tag text-lg font-bold uppercase tracking-[0.04em]">
              Contas do mês
            </h2>
            <div className="space-y-1">
              <Label htmlFor="bills-month" className="text-xs">Mês</Label>
              <Input id="bills-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-[160px]" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bills-status" className="text-xs">Situação</Label>
              <select
                id="bills-status"
                className="h-10 w-full border border-input bg-paper px-3 text-sm text-ink focus-visible:border-denim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-denim h-9 w-[140px]"
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
              >
                <option value="pending">Pendentes</option>
                <option value="paid">Pagas</option>
                <option value="all">Todas</option>
              </select>
            </div>
            <Button variant="outline" size="sm" onClick={fetchBills}>
              Atualizar
            </Button>
          </div>
          {loading ? (
            <div className="space-y-2 p-4" aria-hidden="true">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse bg-sub" />)}</div>
          ) : bills.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-ink-3">Nenhuma conta neste mês com esse filtro.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Vencimento</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                  <TableHead className="pr-4 text-right"><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills.map((b) => {
                  const d = tsToDate(b.dueDate);
                  const typeLabel =
                    b.kind === "FIXED" ? "Fixa" : b.kind === "ONE_TIME" ? "Avulsa" : b.installmentNumber && b.installmentsCount
                      ? `Parcela ${b.installmentNumber}/${b.installmentsCount}`
                      : "Parcelada";

                  return (
                    <TableRow key={b.id}>
                      <TableCell className="pl-4 tabular-nums">{formatDateBR(d)}</TableCell>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell>{typeLabel}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(b.amount)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={b.status === "PAID" ? "positive" : "destructive"}>
                          {b.status === "PAID" ? "Pago" : "Pendente"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {b.status === "PENDING" && (
                            <Button size="icon" variant="ghost" className="text-verde hover:bg-verde-tint" onClick={() => setPayingBill({ id: b.id, name: b.name })} title="Marcar como pago" aria-label={`Marcar ${b.name} como paga`}>
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" className="hover:bg-vermelho-tint hover:text-vermelho" onClick={() => handleDelete(b.id)} title="Excluir" aria-label={`Excluir ${b.name}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </section>

        <section className="h-fit border border-rule bg-paper" aria-labelledby="new-bill-title">
          <h2 id="new-bill-title" className="border-b border-rule px-4 py-3 font-tag text-lg font-bold uppercase tracking-[0.04em]">
            Nova conta
          </h2>
          <div className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="bill-name">Nome</Label>
              <Input id="bill-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: aluguel" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bill-amount">Valor (R$)</Label>
              <Input id="bill-amount" value={amount} onChange={(e) => setAmount(e.target.value)} type="number" inputMode="decimal" step="0.01" className="tabular-nums" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bill-kind">Tipo</Label>
              <select
                id="bill-kind"
                className="h-10 w-full border border-input bg-paper px-3 text-sm text-ink focus-visible:border-denim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-denim"
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                <option value="ONE_TIME">Avulsa</option>
                <option value="FIXED">Fixa</option>
                <option value="INSTALLMENTS">Parcelada</option>
              </select>
            </div>
          </div>

          {kind === "ONE_TIME" && (
            <div className="space-y-2">
              <Label>Vencimento</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          )}

          {kind === "FIXED" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Dia do vencimento</Label>
                <Input type="number" min="1" max="31" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Meses à frente</Label>
                <Input type="number" min="1" max="36" value={monthsAhead} onChange={(e) => setMonthsAhead(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Início</Label>
                <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
              </div>
            </div>
          )}

          {kind === "INSTALLMENTS" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>1º vencimento</Label>
                <Input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Nº parcelas</Label>
                <Input type="number" min="1" max="60" value={installmentsCount} onChange={(e) => setInstallmentsCount(e.target.value)} />
              </div>
            </div>
          )}

          <div className="flex justify-end border-t border-rule pt-4">
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Salvando…" : "Adicionar conta"}
            </Button>
          </div>
          </div>
        </section>
      </div>
    </div>
  );
}
