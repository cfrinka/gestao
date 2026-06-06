"use client";

import { useState, useEffect, useMemo } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Percent, TrendingUp, Users, Loader2, RefreshCw } from "lucide-react";

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

  useEffect(() => {
    fetchCommissionData();
  }, []);

  async function fetchCommissionData() {
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
  }

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
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Comissão</h1>
          <p className="text-gray-500">Cálculo de comissão sobre vendas (3%)</p>
        </div>
        {commissionData?.isAdmin && (
          <Button onClick={handleSync} disabled={syncing} variant="outline" className="gap-2">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sincronizar dados antigos
          </Button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total de Vendas</CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900">{formatCurrency(grandTotalSales)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total de Comissões</CardTitle>
            <Percent className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900">{formatCurrency(grandTotalCommission)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Vendedores</CardTitle>
            <Users className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900">{commissionData?.data.length || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Admin: tabs per user. Non-admin: single view */}
      {commissionData?.isAdmin ? (
        <Tabs value={selectedUserId} onValueChange={setSelectedUserId}>
          <TabsList className="flex flex-wrap gap-1 h-auto">
            {commissionData.data.map((user) => (
              <TabsTrigger key={user.userId} value={user.userId} className="text-xs">
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
            <Card>
              <CardContent className="py-8 text-center text-gray-500">
                Nenhuma venda registrada para calcular comissão.
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Overall table for admin */}
      {commissionData?.isAdmin && allMonths.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Visão Geral por Mês</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Total Vendas</TableHead>
                  <TableHead className="text-right">Total Comissão (3%)</TableHead>
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
                      <TableCell className="text-right text-green-600 font-medium">
                        {formatCurrency(monthTotalCommission)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-gray-50 font-bold">
                  <TableCell>Total Geral</TableCell>
                  <TableCell className="text-right">{formatCurrency(grandTotalSales)}</TableCell>
                  <TableCell className="text-right text-green-700">
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
            <p className="text-sm text-gray-500 mt-1">
              Total vendido: {formatCurrency(user.totalSalesOverall)} | Comissão: {formatCurrency(user.totalCommission)}
            </p>
          </div>
          <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>
            {user.role === "ADMIN" ? "Administrador" : "Caixa"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {user.months.length === 0 ? (
          <p className="text-center text-gray-500 py-4">Nenhuma venda registrada.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                <TableHead className="text-right">Vendas Brutas</TableHead>
                <TableHead className="text-right">Comissão (3%)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {user.months.map((month) => (
                <TableRow key={month.month}>
                  <TableCell className="font-medium">{formatMonthLabel(month.month)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(month.totalSales)}</TableCell>
                  <TableCell className="text-right text-green-600 font-medium">
                    {formatCurrency(month.commission)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-gray-50 font-bold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">{formatCurrency(user.totalSalesOverall)}</TableCell>
                <TableCell className="text-right text-green-700">
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
