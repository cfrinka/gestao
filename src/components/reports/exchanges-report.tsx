"use client";

import { useState } from "react";
import { TotalsStrip } from "@/components/etiqueta/totals-strip";
import { TagHeader, TagRow } from "@/components/etiqueta/tag-row";
import { ProductPhoto } from "@/components/etiqueta/product-photo";
import { cn } from "@/lib/utils";
import { ChoiceRow, ReportHeading, ReportState, SizeBox, useReport } from "./report-shared";

interface ExchangeData {
  periodDays: number;
  count: number;
  piecesIn: number;
  piecesOut: number;
  products: Array<{
    productId: string;
    name: string;
    sku: string;
    image?: string;
    piecesIn: number;
    exchanges: number;
    sizesIn: Array<{ size: string; pieces: number }>;
    sizeSwaps: number;
  }>;
  sizeSwaps: Array<{ from: string; to: string; count: number }>;
}

const PERIODS = [
  [30, "30 dias"],
  [90, "90 dias"],
  [180, "180 dias"],
] as const;

const ROW_GRID = "lg:grid-cols-[minmax(0,1fr)_minmax(0,240px)_96px_96px_120px]";

export function ExchangesReport() {
  const [days, setDays] = useState<30 | 90 | 180>(90);
  const { data, loading, error } = useReport<ExchangeData>(`/api/reports/exchange-insights?days=${days}`);
  const products = data?.products ?? [];
  const swapsTotal = (data?.sizeSwaps ?? []).reduce((sum, swap) => sum + swap.count, 0);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <ChoiceRow label="Trocas dos últimos" options={PERIODS} value={days} onChange={(v) => setDays(v as 30 | 90 | 180)} />
        <TotalsStrip
          items={[
            { label: "Trocas", value: loading ? "…" : data?.count ?? 0 },
            { label: "Peças devolvidas", value: loading ? "…" : data?.piecesIn ?? 0 },
            { label: "Peças levadas", value: loading ? "…" : data?.piecesOut ?? 0 },
            { label: "Troca de tamanho", value: loading ? "…" : swapsTotal, hint: "mesma peça, outro tamanho" },
          ]}
        />
      </div>

      {!loading && !error && (data?.sizeSwaps.length ?? 0) > 0 ? (
        <section aria-labelledby="swaps">
          <ReportHeading id="swaps" note="Quando a peça volta e sai a mesma em outro tamanho">
            Tamanho que não serviu
          </ReportHeading>
          <ul className="flex flex-wrap gap-2">
            {data!.sizeSwaps.map((swap) => (
              <li key={`${swap.from}-${swap.to}`} className="flex items-center gap-2 border border-rule bg-paper px-3 py-2">
                <SizeBox size={swap.from} />
                <span aria-hidden="true" className="text-ink-3">→</span>
                <SizeBox size={swap.to} />
                <span className="sr-only">
                  de {swap.from} para {swap.to}:
                </span>
                <span className="ml-1 text-sm font-semibold tabular-nums text-ink">
                  {swap.count} {swap.count === 1 ? "vez" : "vezes"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="returned">
        <ReportHeading id="returned" note="Da que mais volta para a que menos volta">
          O que mais volta
        </ReportHeading>
        <ReportState
          loading={loading}
          error={error}
          empty={!loading && !error && products.length === 0}
          emptyText="Nenhuma troca no período."
        />
        {!loading && !error && products.length > 0 ? (
          <>
            <TagHeader className={cn("hidden lg:grid lg:gap-x-4", ROW_GRID)}>
              <span>Produto</span>
              <span>Tamanhos devolvidos</span>
              <span className="text-right">Peças</span>
              <span className="text-right">Trocas</span>
              <span className="text-right">Outro tamanho</span>
            </TagHeader>
            <ul className="space-y-2">
              {products.map((line) => (
                <li key={line.productId}>
                  <TagRow className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2", ROW_GRID)}>
                    <div className="flex min-w-0 items-center gap-3">
                      <ProductPhoto src={line.image} name={line.name} className="h-11 w-11" />
                      <div className="min-w-0">
                        <p className="line-clamp-2 font-semibold leading-snug">{line.name}</p>
                        <p className="text-xs tracking-[0.04em] text-ink-3">{line.sku}</p>
                      </div>
                    </div>
                    <p className="font-tag text-xl font-extrabold tabular-nums text-ink lg:hidden">{line.piecesIn}</p>
                    <div className="col-span-2 flex flex-wrap gap-2 lg:col-span-1">
                      {line.sizesIn.length > 0 ? (
                        line.sizesIn.map((size) => (
                          <span key={size.size} className="inline-flex items-center gap-1 text-sm tabular-nums text-ink-2">
                            <SizeBox size={size.size} />×{size.pieces}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-ink-3">Sem grade</span>
                      )}
                    </div>
                    <p className="col-span-2 text-sm text-ink-2 lg:hidden">
                      {line.exchanges} {line.exchanges === 1 ? "troca" : "trocas"}
                      {line.sizeSwaps > 0 ? ` · ${line.sizeSwaps} por outro tamanho` : ""}
                    </p>
                    <p className="hidden text-right font-tag text-xl font-extrabold tabular-nums lg:block">{line.piecesIn}</p>
                    <p className="hidden text-right tabular-nums lg:block">{line.exchanges}</p>
                    <p className="hidden text-right tabular-nums text-ink-2 lg:block">{line.sizeSwaps || "—"}</p>
                  </TagRow>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </div>
  );
}
