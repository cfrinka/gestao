"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { apiGet } from "@/lib/api-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";

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
        <p className="text-ink-3">Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Correções de débito"
        meta={<span>Registro de todas as correções feitas nas contas de fiado</span>}
      />

          <div className="space-y-4">
              <div className="relative w-full sm:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2" aria-hidden="true" />
                <Input
                  id="search"
                  aria-label="Buscar correção"
                  placeholder="Buscar por cliente ou motivo"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

            {loading ? (
              <div className="space-y-2" aria-hidden="true">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse border border-rule bg-paper" />)}</div>
            ) : filteredCorrections.length === 0 ? (
              <p className="border border-rule bg-paper px-5 py-12 text-center text-sm text-ink-3">
                {searchTerm ? "Nenhuma correção encontrada com essa busca." : "Nenhuma correção registrada até agora."}
              </p>
            ) : (
              <div className="border border-rule bg-paper">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Data</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Correção</TableHead>
                      <TableHead>Saldo antes</TableHead>
                      <TableHead>Saldo depois</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Competência</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCorrections.map((correction) => (
                      <TableRow key={correction.id}>
                        <TableCell className="pl-4 tabular-nums">
                          {new Date(correction.createdAt).toLocaleDateString("pt-BR")}
                        </TableCell>
                        <TableCell className="font-medium">{correction.clientName}</TableCell>
                        <TableCell className={`font-semibold tabular-nums ${correction.correctionAmount < 0 ? "text-verde" : "text-vermelho"}`}>
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
    </div>
  );
}
