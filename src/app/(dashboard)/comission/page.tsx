"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { TotalsStrip } from "@/components/etiqueta/totals-strip";

interface CommissionMonth {
  month: string;
  totalSales: number;
  commission: number;
}

interface UserCommission {
  userId: string;
  userName: string;
  role: string;
  months: CommissionMonth[];
  totalSalesOverall: number;
  totalCommission: number;
}

interface CommissionResponse {
  isAdmin: boolean;
  currentUserId: string;
  data: UserCommission[];
}

function formatMonthLabel(month: string): string {
  const [year, mon] = month.split("-");
  const monthNames = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  const monthIndex = parseInt(mon, 10) - 1;
  return `${monthNames[monthIndex]} ${year}`;
}

export default function CommissionPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [commissionData, setCommissionData] = useState<CommissionResponse | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  const fetchCommissionData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiGet("/api/comission") as CommissionResponse;
      setCommissionData(data);
      if (data.data.length > 0) {
        setSelectedUserId(data.data[0].userId);
      }
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Erro ao carregar comissões",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchCommissionData();
  }, [fetchCommissionData]);

  async function handleSync() {
    try {
      setSyncing(true);
      const result = await apiPost("/api/comission", {}) as { synced: number; message: string };
      toast({
        title: result.message || "Sincronização concluída",
        variant: "default",
      });
      // Refresh data after sync
      await fetchCommissionData();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Erro ao sincronizar dados",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  }

  const selectedUser = useMemo(() => {
    return commissionData?.data.find((u) => u.userId === selectedUserId) || null;
  }, [commissionData, selectedUserId]);

  const allMonths = useMemo(() => {
    const monthSet = new Set<string>();
    commissionData?.data.forEach((user) => {
      user.months.forEach((m) => monthSet.add(m.month));
    });
    return Array.from(monthSet).sort((a, b) => b.localeCompare(a));
  }, [commissionData]);

  const grandTotalSales = useMemo(() => {
    return commissionData?.data.reduce((sum, u) => sum + u.totalSalesOverall, 0) || 0;
  }, [commissionData]);

  const grandTotalCommission = useMemo(() => {
    return commissionData?.data.reduce((sum, u) => sum + u.totalCommission, 0) || 0;
  }, [commissionData]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Comissão" />
        <div className="space-y-2" aria-hidden="true">
          <div className="h-16 animate-pulse border border-rule bg-paper" />
          <div className="h-64 animate-pulse border border-rule bg-paper" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Comissão"
        meta={<span>3% sobre o valor vendido, por mês</span>}
        actions={
          commissionData?.isAdmin ? (
            <Button onClick={handleSync} disabled={syncing} variant="outline" size="sm">
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sincronizar dados antigos
            </Button>
          ) : null
        }
        className="mb-0 md:mb-0"
      />

      <TotalsStrip
        items={[
          { label: "Total vendido", value: formatCurrency(grandTotalSales) },
          { label: "Comissões", value: formatCurrency(grandTotalCommission), tone: "positive" },
          { label: "Vendedores", value: commissionData?.data.length || 0 },
        ]}
      />

      {/* Admin: tabs per user. Non-admin: single view */}
      {commissionData?.isAdmin ? (
        <Tabs value={selectedUserId} onValueChange={setSelectedUserId}>
          <TabsList className="flex h-auto flex-wrap">
            {commissionData.data.map((user) => (
              <TabsTrigger key={user.userId} value={user.userId} className="h-10">
                {user.userName}
              </TabsTrigger>
            ))}
          </TabsList>

          {commissionData.data.map((user) => (
            <TabsContent key={user.userId} value={user.userId}>
              <UserCommissionTable user={user} />
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <div>
          {selectedUser ? (
            <UserCommissionTable user={selectedUser} />
          ) : (
            <p className="border border-rule bg-paper px-5 py-12 text-center text-sm text-ink-3">
              Nenhuma venda registrada para calcular comissão.
            </p>
          )}
        </div>
      )}

      {/* Overall table for admin */}
      {commissionData?.isAdmin && allMonths.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Todos os vendedores, por mês</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Vendido</TableHead>
                  <TableHead className="text-right">Comissão (3%)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allMonths.map((month) => {
                  const monthTotalSales = commissionData.data.reduce(
                    (sum, user) => sum + (user.months.find((m) => m.month === month)?.totalSales || 0),
                    0
                  );
                  const monthTotalCommission = monthTotalSales * 0.03;
                  return (
                    <TableRow key={month}>
                      <TableCell className="font-medium">{formatMonthLabel(month)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(monthTotalSales)}</TableCell>
                      <TableCell className="text-right text-verde font-medium">
                        {formatCurrency(monthTotalCommission)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="border-t-2 border-ink bg-sub font-bold hover:bg-sub">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{formatCurrency(grandTotalSales)}</TableCell>
                  <TableCell className="text-right text-verde">
                    {formatCurrency(grandTotalCommission)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function UserCommissionTable({ user }: { user: UserCommission }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{user.userName}</CardTitle>
            <p className="text-sm text-ink-3 mt-1">
              Vendeu {formatCurrency(user.totalSalesOverall)} · comissão {formatCurrency(user.totalCommission)}
            </p>
          </div>
          <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>
            {user.role === "ADMIN" ? "Administrador" : "Caixa"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {user.months.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-3">Nenhuma venda registrada.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                <TableHead className="text-right">Vendido</TableHead>
                <TableHead className="text-right">Comissão (3%)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {user.months.map((month) => (
                <TableRow key={month.month}>
                  <TableCell className="font-medium">{formatMonthLabel(month.month)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(month.totalSales)}</TableCell>
                  <TableCell className="text-right text-verde font-medium">
                    {formatCurrency(month.commission)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-ink bg-sub font-bold hover:bg-sub">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">{formatCurrency(user.totalSalesOverall)}</TableCell>
                <TableCell className="text-right text-verde">
                  {formatCurrency(user.totalCommission)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
