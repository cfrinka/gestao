"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { apiGet } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import { Search, FileText } from "lucide-react";

interface DebtCorrection {
  id: string;
  clientId: string;
  clientName: string;
  correctionAmount: number;
  previousBalance: number;
  newBalance: number;
  reason: string;
  createdAt: string;
  competencyMonth: string;
}

export default function DebtCorrectionsPage() {
  const { userData } = useAuth();
  const [corrections, setCorrections] = useState<DebtCorrection[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const fetchCorrections = async () => {
    try {
      const data = await apiGet("/api/debt-corrections");
      setCorrections(Array.isArray(data) ? data : []);
    } catch {
      setCorrections([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCorrections();
  }, []);

  const filteredCorrections = corrections.filter((correction) =>
    correction.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    correction.reason.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Only ADMIN can access this page
  if (userData?.role === "CASHIER") {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-500">Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Correções de Débito</h1>
          <p className="text-gray-500">Histórico de correções administrativas de débito</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Auditoria de Correções
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="search">Buscar:</Label>
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  id="search"
                  placeholder="Cliente ou motivo..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {loading ? (
              <p className="text-center py-4">Carregando...</p>
            ) : filteredCorrections.length === 0 ? (
              <p className="text-center py-4 text-gray-500">
                {searchTerm ? "Nenhuma correção encontrada" : "Nenhuma correção registrada"}
              </p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Valor Corrigido</TableHead>
                      <TableHead>Saldo Anterior</TableHead>
                      <TableHead>Novo Saldo</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Mês Competência</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCorrections.map((correction) => (
                      <TableRow key={correction.id}>
                        <TableCell>
                          {new Date(correction.createdAt).toLocaleDateString("pt-BR")}
                        </TableCell>
                        <TableCell className="font-medium">{correction.clientName}</TableCell>
                        <TableCell className={correction.correctionAmount < 0 ? "text-green-600" : "text-red-600"}>
                          {formatCurrency(correction.correctionAmount)}
                        </TableCell>
                        <TableCell>{formatCurrency(correction.previousBalance)}</TableCell>
                        <TableCell>{formatCurrency(correction.newBalance)}</TableCell>
                        <TableCell className="max-w-xs truncate" title={correction.reason}>
                          {correction.reason}
                        </TableCell>
                        <TableCell>{correction.competencyMonth}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
