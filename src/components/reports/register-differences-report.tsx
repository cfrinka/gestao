"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { TotalsStrip } from "@/components/etiqueta/totals-strip";
import { cn, formatCurrency } from "@/lib/utils";
import { formatStoreDate, formatStoreTime } from "@/lib/dates";
import { ChoiceRow, ReportHeading, ReportState, useReport } from "./report-shared";

interface OperatorLine {
  operatorId: string;
  operator: string;
  closings: number;
  withDifference: number;
  aboveTolerance: number;
  notCounted: number;
  missing: number;
  over: number;
  net: number;
  worstMissing: number;
}

interface ClosingLine {
  registerId: string;
  operator: string;
  openedAt: string | null;
  closedAt: string | null;
  expected: number;
  counted: number;
  difference: number;
  note: string | null;
  aboveTolerance: boolean;
  notCounted: boolean;
}

interface DifferencesData {
  periodDays: number;
  tolerance: number;
  operators: OperatorLine[];
  closings: ClosingLine[];
  totals: {
    closings: number;
    withDifference: number;
    aboveTolerance: number;
    notCounted: number;
    missing: number;
    over: number;
    net: number;
  };
}

const PERIODS = [
  [30, "30 dias"],
  [90, "90 dias"],
  [180, "180 dias"],
] as const;

const OPERATOR_GRID = "sm:grid-cols-[minmax(0,1fr)_96px_104px_112px_112px_112px]";

/** "−R$ 20,00" for cash missing, "+R$ 5,00" for cash over. */
function signed(value: number): string {
  if (Math.abs(value) < 0.005) return formatCurrency(0);
  return `${value < 0 ? "−" : "+"}${formatCurrency(Math.abs(value))}`;
}

function differenceTone(value: number): string {
  if (value <= -0.005) return "text-vermelho";
  if (value >= 0.005) return "text-verde";
  return "text-ink";
}

export function RegisterDifferencesReport() {
  const [days, setDays] = useState<30 | 90 | 180>(90);
  const { data, loading, error } = useReport<DifferencesData>(`/api/reports/register-differences?days=${days}`);
  const operators = data?.operators ?? [];
  const closings = data?.closings ?? [];
  const tolerance = data?.tolerance ?? 0;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <ChoiceRow label="Fechamentos dos últimos" options={PERIODS} value={days} onChange={(v) => setDays(v as 30 | 90 | 180)} />
        <TotalsStrip
          items={[
            {
              label: "Fechamentos",
              value: loading ? "…" : data?.totals.closings ?? 0,
              hint: loading
                ? null
                : [
                    `${data?.totals.withDifference ?? 0} com diferença`,
                    data?.totals.notCounted ? `${data.totals.notCounted} sem contagem` : null,
                  ]
                    .filter(Boolean)
                    .join(" · "),
            },
            { label: "Faltou", value: loading ? "…" : formatCurrency(data?.totals.missing ?? 0), tone: "debt" },
            { label: "Sobrou", value: loading ? "…" : formatCurrency(data?.totals.over ?? 0), tone: "positive" },
            {
              label: `Acima de ${formatCurrency(tolerance)}`,
              value: loading ? "…" : data?.totals.aboveTolerance ?? 0,
              tone: (data?.totals.aboveTolerance ?? 0) > 0 ? "debt" : "neutral",
              hint: "pedem o motivo no fechamento",
            },
          ]}
        />
      </div>

      <section aria-labelledby="by-operator">
        <ReportHeading id="by-operator" note="Contado no fechamento menos o esperado na gaveta">
          Por operador
        </ReportHeading>
        <ReportState
          loading={loading}
          error={error}
          empty={!loading && !error && operators.length === 0}
          emptyText="Nenhum caixa fechado no período."
        />
        {!loading && !error && operators.length > 0 ? (
          <>
            <div
              aria-hidden="true"
              className={cn(
                "hidden px-4 pb-2 font-tag text-xs font-bold uppercase tracking-[0.08em] text-ink-2 sm:grid sm:gap-x-4",
                OPERATOR_GRID
              )}
            >
              <span>Operador</span>
              <span className="text-right">Fechamentos</span>
              <span className="text-right">Com diferença</span>
              <span className="text-right">Faltou</span>
              <span className="text-right">Sobrou</span>
              <span className="text-right">Saldo</span>
            </div>
            <ul className="divide-y divide-rule border border-rule bg-paper">
              {operators.map((line) => (
                <li key={line.operatorId} className={cn("grid gap-x-4 gap-y-1 px-4 py-3 sm:items-center", OPERATOR_GRID)}>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{line.operator}</p>
                    {line.worstMissing > 0 || line.notCounted > 0 ? (
                      <p className="text-xs text-ink-3">
                        {[
                          line.worstMissing > 0 ? `Maior falta: ${formatCurrency(line.worstMissing)}` : null,
                          line.notCounted > 0 ? `${line.notCounted} fechado${line.notCounted === 1 ? "" : "s"} sem contar` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}
                    <p className="mt-1 flex flex-wrap gap-x-4 text-sm text-ink-2 sm:hidden">
                      <span>
                        {line.closings} fechamento{line.closings === 1 ? "" : "s"}, {line.withDifference} com diferença
                      </span>
                      <span className={line.missing > 0 ? "text-vermelho" : undefined}>faltou {formatCurrency(line.missing)}</span>
                      <span className={line.over > 0 ? "text-verde" : undefined}>sobrou {formatCurrency(line.over)}</span>
                    </p>
                  </div>
                  <p className="hidden text-right tabular-nums sm:block">{line.closings}</p>
                  <p className="hidden text-right tabular-nums sm:block">
                    {line.withDifference}
                    {line.aboveTolerance > 0 ? (
                      <span className="block text-xs text-vermelho">{line.aboveTolerance} acima do tolerado</span>
                    ) : null}
                  </p>
                  <p className={cn("hidden text-right tabular-nums sm:block", line.missing > 0 ? "font-semibold text-vermelho" : "text-ink-3")}>
                    {formatCurrency(line.missing)}
                  </p>
                  <p className={cn("hidden text-right tabular-nums sm:block", line.over > 0 ? "font-semibold text-verde" : "text-ink-3")}>
                    {formatCurrency(line.over)}
                  </p>
                  <p className={cn("font-tag text-xl font-extrabold tabular-nums sm:text-right", differenceTone(line.net))}>
                    {signed(line.net)}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section aria-labelledby="closings">
        <ReportHeading id="closings" note="Do mais recente para o mais antigo">
          Fechamentos com diferença
        </ReportHeading>
        {!loading && !error && (data?.totals.notCounted ?? 0) > 0 ? (
          <p className="mb-3 border-l-[3px] border-denim bg-denim-tint px-3 py-2 text-sm text-ink">
            {data?.totals.notCounted} caixa{data?.totals.notCounted === 1 ? " foi fechado" : "s foram fechados"} com contagem
            zerada. Ficam de fora do que faltou, porque o dinheiro não foi contado. Daqui em diante, fechar sem contar pede o motivo.
          </p>
        ) : null}
        <ReportState
          loading={loading}
          error={error}
          empty={!loading && !error && closings.length === 0}
          emptyText="Todos os caixas do período fecharam certinho."
        />
        {!loading && !error && closings.length > 0 ? (
          <ul className="divide-y divide-rule border border-rule bg-paper">
            {closings.map((line) => {
              const closedAt = line.closedAt ? new Date(line.closedAt) : null;
              return (
                <li key={line.registerId} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{line.operator}</span>
                      <span className="text-sm text-ink-2">
                        {closedAt ? `${formatStoreDate(closedAt)} às ${formatStoreTime(closedAt)}` : "Sem data"}
                      </span>
                      {line.aboveTolerance ? <Badge variant="destructive">Acima do tolerado</Badge> : null}
                      {line.notCounted ? <Badge variant="secondary">Sem contagem</Badge> : null}
                    </p>
                    <p className="mt-0.5 text-sm tabular-nums text-ink-2">
                      {line.notCounted
                        ? `Fechado sem contar o dinheiro · esperado ${formatCurrency(line.expected)}`
                        : `Esperado ${formatCurrency(line.expected)} · contado ${formatCurrency(line.counted)}`}
                    </p>
                    <p className={cn("mt-1 text-sm", line.note ? "text-ink" : "text-ink-3")}>
                      {line.note ? `Motivo: ${line.note}` : "Sem motivo registrado"}
                    </p>
                  </div>
                  {line.notCounted ? (
                    <p className="text-right font-tag text-base font-bold uppercase tracking-[0.04em] text-ink-3">Não contado</p>
                  ) : (
                    <p className={cn("text-right font-tag text-2xl font-extrabold tabular-nums", differenceTone(line.difference))}>
                      {signed(line.difference)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
