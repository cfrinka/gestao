"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { TotalsStrip } from "@/components/etiqueta/totals-strip";
import { TagHeader, TagRow } from "@/components/etiqueta/tag-row";
import { ProductPhoto } from "@/components/etiqueta/product-photo";
import { cn } from "@/lib/utils";
import { ChoiceRow, ReportHeading, ReportState, SizeBox, formatDays, useReport } from "./report-shared";

interface SizeSummary {
  size: string;
  sold: number;
  stock: number;
  sellThrough: number;
}

interface RestockLine {
  productId: string;
  name: string;
  sku: string;
  image?: string;
  size: string;
  sold: number;
  stock: number;
  perWeek: number;
  coverDays: number | null;
  suggested: number;
  urgency: "esgotado" | "acabando" | "atencao";
}

interface RestockData {
  basisDays: number;
  piecesSold: number;
  bySize: SizeSummary[];
  restock: RestockLine[];
}

const BASIS = [
  [30, "30 dias"],
  [60, "60 dias"],
  [90, "90 dias"],
] as const;

const URGENCY_LABEL = { esgotado: "Esgotado", acabando: "Acabando", atencao: "Atenção" } as const;

const ROW_GRID = "lg:grid-cols-[minmax(0,1fr)_64px_88px_88px_112px_96px]";

export function RestockReport() {
  const [days, setDays] = useState<30 | 60 | 90>(30);
  const { data, loading, error } = useReport<RestockData>(`/api/reports/restock?days=${days}`);
  const restock = data?.restock ?? [];
  const soldOut = restock.filter((line) => line.urgency === "esgotado").length;
  const toBuy = restock.reduce((sum, line) => sum + line.suggested, 0);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <ChoiceRow label="Ritmo de venda dos últimos" options={BASIS} value={days} onChange={(v) => setDays(v as 30 | 60 | 90)} />
        <TotalsStrip
          items={[
            { label: "Peças vendidas", value: loading ? "…" : data?.piecesSold ?? 0 },
            { label: "Tamanhos para repor", value: loading ? "…" : restock.length },
            { label: "Esgotados com procura", value: loading ? "…" : soldOut, tone: soldOut > 0 ? "debt" : "neutral" },
            { label: "Peças sugeridas", value: loading ? "…" : toBuy, tone: "info" },
          ]}
        />
      </div>

      <section aria-labelledby="by-size">
        <ReportHeading id="by-size" note="Quanto de cada tamanho saiu, contra o que ainda há em estoque">
          Vendas por tamanho
        </ReportHeading>
        <ReportState loading={loading} error={error} empty={!loading && !error && (data?.bySize.length ?? 0) === 0} emptyText="Sem vendas nem estoque no período." />
        {!loading && !error && data && data.bySize.length > 0 ? (
          <ul className="grid grid-cols-3 gap-px border border-rule bg-rule sm:grid-cols-5 lg:grid-cols-7">
            {data.bySize.map((row) => (
              <li key={row.size} className="bg-paper px-3 py-2.5">
                <p className="font-tag text-xl font-extrabold uppercase leading-none tracking-[0.04em] text-ink">{row.size}</p>
                <p className="mt-2 text-sm tabular-nums text-ink">
                  <b className="font-semibold">{row.sold}</b> {row.sold === 1 ? "vendida" : "vendidas"}
                </p>
                <p className="text-xs tabular-nums text-ink-3">{row.stock} em estoque</p>
                <div className="mt-2 h-1 bg-sub" aria-hidden="true">
                  <div className="h-1 bg-denim" style={{ width: `${Math.round(row.sellThrough * 100)}%` }} />
                </div>
                <p className="mt-1 text-xs tabular-nums text-ink-2">{Math.round(row.sellThrough * 100)}% saiu</p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="restock">
        <ReportHeading id="restock" note={`Para durar 30 dias no ritmo dos últimos ${days} dias`}>
          O que repor
        </ReportHeading>
        <ReportState
          loading={loading}
          error={error}
          empty={!loading && !error && restock.length === 0}
          emptyText="Nada para repor agora: o que vendeu tem estoque para mais de três semanas."
        />
        {!loading && !error && restock.length > 0 ? (
          <>
            <TagHeader className={cn("hidden lg:grid lg:gap-x-4", ROW_GRID)}>
              <span>Produto</span>
              <span>Tam.</span>
              <span className="text-right">Vendidas</span>
              <span className="text-right">Estoque</span>
              <span className="text-right">Dura</span>
              <span className="text-right">Repor</span>
            </TagHeader>
            <ul className="space-y-2">
              {restock.map((line) => (
                <li key={`${line.productId}-${line.size}`}>
                  <TagRow className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2", ROW_GRID)}>
                    <div className="flex min-w-0 items-center gap-3">
                      <ProductPhoto src={line.image} name={line.name} className="h-11 w-11" />
                      <div className="min-w-0">
                        <p className="line-clamp-2 font-semibold leading-snug">{line.name}</p>
                        <p className="flex items-center gap-2 text-xs text-ink-3">
                          <span className="tracking-[0.04em]">{line.sku}</span>
                          <Badge variant={line.urgency === "atencao" ? "secondary" : "destructive"}>{URGENCY_LABEL[line.urgency]}</Badge>
                        </p>
                      </div>
                    </div>
                    <div className="justify-self-end lg:justify-self-start">
                      <SizeBox size={line.size} />
                    </div>
                    <p className="col-span-2 flex flex-wrap gap-x-4 text-sm text-ink-2 lg:hidden">
                      <span><b className="font-semibold tabular-nums text-ink">{line.sold}</b> {line.sold === 1 ? "vendida" : "vendidas"}</span>
                      <span className={cn("tabular-nums", line.stock <= 2 && "font-semibold text-vermelho")}>{line.stock} em estoque</span>
                      <span>{line.coverDays === null ? "acabou" : `dura ~${formatDays(line.coverDays)}`}</span>
                      <span className="font-semibold text-denim">repor {line.suggested}</span>
                    </p>
                    <p className="hidden text-right tabular-nums lg:block">{line.sold}</p>
                    <p className={cn("hidden text-right tabular-nums lg:block", line.stock <= 2 && "font-semibold text-vermelho")}>{line.stock}</p>
                    <p className="hidden text-right text-sm text-ink-2 lg:block">{line.coverDays === null ? "acabou" : `~${formatDays(line.coverDays)}`}</p>
                    <p className="hidden text-right font-tag text-xl font-extrabold tabular-nums text-denim lg:block">+{line.suggested}</p>
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
