"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Check, Trash2 } from "lucide-react";

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
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState<Bill[]>([]);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [status, setStatus] = useState<"all" | "pending" | "paid">("pending");

  const [report, setReport] = useState<StoreReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<"FIXED" | "ONE_TIME" | "INSTALLMENTS">("ONE_TIME");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [dayOfMonth, setDayOfMonth] = useState<string>("5");
  const [monthsAhead, setMonthsAhead] = useState<string>("12");
  const [firstDueDate, setFirstDueDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [installmentsCount, setInstallmentsCount] = useState<string>("3");

  const fetchBills = async () => {
    setLoading(true);
    try {
      const data = await apiGet(`/api/bills?month=${encodeURIComponent(month)}&status=${encodeURIComponent(status)}`);
      setBills(Array.isArray(data) ? data : []);
    } catch (error) {
      toast({ title: "Erro ao carregar contas", variant: "destructive" });
      setBills([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchReport = async () => {
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
    } catch (error) {
      setReport(null);
      toast({ title: "Erro ao carregar lucro do mês", variant: "destructive" });
    } finally {
      setReportLoading(false);
    }
  };

  useEffect(() => {
    if (userData?.role === "ADMIN") {
      fetchBills();
      fetchReport();
    }
  }, [month, status, userData?.role]);

  const totals = useMemo(() => {
    const pending = bills.filter((b) => b.status === "PENDING").reduce((s, b) => s + (b.amount || 0), 0);
    const paid = bills.filter((b) => b.status === "PAID").reduce((s, b) => s + (b.amount || 0), 0);
    return { pending, paid };
  }, [bills]);

  const handleMarkPaid = async (billId: string) => {
    const method = prompt("Forma de pagamento (DINHEIRO/DEBITO/CREDITO/PIX):", "DINHEIRO") || "DINHEIRO";
    try {
      await apiPatch(`/api/bills/${billId}`, { action: "mark_paid", method });
      toast({ title: "Conta marcada como paga" });
      fetchBills();
    } catch (error) {
      toast({ title: "Erro ao atualizar conta", variant: "destructive" });
    }
  };

  const handleDelete = async (billId: string) => {
    if (!confirm("Excluir esta conta?")) return;
    try {
      await apiDelete(`/api/bills/${billId}`);
      toast({ title: "Conta excluída" });
      fetchBills();
    } catch (error) {
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
    try {
      if (kind === "ONE_TIME") {
        await apiPost("/api/bills", { kind: "ONE_TIME", name: name.trim(), amount: parsed, dueDate });
      } else if (kind === "FIXED") {
        await apiPost("/api/bills", {
          kind: "FIXED",
          name: name.trim(),
          amount: parsed,
          dayOfMonth: parseInt(dayOfMonth, 10),
          monthsAhead: parseInt(monthsAhead, 10),
          startMonth: month,
        });
      } else {
        await apiPost("/api/bills", {
          kind: "INSTALLMENTS",
          name: name.trim(),
          amount: parsed,
          firstDueDate,
          installmentsCount: parseInt(installmentsCount, 10),
          intervalMonths: 1,
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
        <p className="text-gray-500">Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Contas</h1>
        <p className="text-gray-500">Controle de contas e despesas da loja</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Lucro (mês)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[#355444]">
              {reportLoading ? "..." : formatCurrency(report?.profit || 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pendente (mês)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{formatCurrency(totals.pending)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pago (mês)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(totals.paid)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="space-y-2">
            <Label>Mês</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <select
              className="w-full p-2 border rounded-md md:w-48"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="pending">Pendentes</option>
              <option value="paid">Pagas</option>
              <option value="all">Todas</option>
            </select>
          </div>
          <Button variant="outline" onClick={fetchBills}>
            Atualizar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Adicionar Conta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2 md:col-span-2">
              <Label>Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Aluguel" />
            </div>
            <div className="space-y-2">
              <Label>Valor</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <select
                className="w-full p-2 border rounded-md"
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
            <div className="grid gap-4 md:grid-cols-3">
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
            <div className="grid gap-4 md:grid-cols-3">
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

          <div className="flex justify-end">
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Salvando..." : "Adicionar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contas do Mês</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-4">Carregando...</p>
          ) : bills.length === 0 ? (
            <p className="text-center py-4 text-gray-500">Nenhuma conta encontrada</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
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
                      <TableCell>{formatDateBR(d)}</TableCell>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell>{typeLabel}</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(b.amount)}</TableCell>
                      <TableCell className={`text-right font-bold ${b.status === "PAID" ? "text-green-600" : "text-red-600"}`}>
                        {b.status === "PAID" ? "Pago" : "Pendente"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {b.status === "PENDING" && (
                            <Button size="icon" variant="ghost" onClick={() => handleMarkPaid(b.id)} title="Marcar como pago">
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" className="text-red-500" onClick={() => handleDelete(b.id)} title="Excluir">
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
        </CardContent>
      </Card>
    </div>
  );
}
