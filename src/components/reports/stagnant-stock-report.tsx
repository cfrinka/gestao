"use client";

import { useState } from "react";
import { TotalsStrip } from "@/components/etiqueta/totals-strip";
import { TagHeader, TagRow } from "@/components/etiqueta/tag-row";
import { ProductPhoto } from "@/components/etiqueta/product-photo";
import { SizeGrid } from "@/components/etiqueta/size-grid";
import { cn, formatCurrency } from "@/lib/utils";
import { formatStoreDate } from "@/lib/dates";
import { ChoiceRow, ReportHeading, ReportState, formatDays, useReport } from "./report-shared";

interface StagnantLine {
  productId: string;
  name: string;
  sku: string;
  image?: string;
  stock: number;
  costValue: number;
  saleValue: number;
  days: number;
  noSaleInWindow: boolean;
  lastSaleAt: string | null;
  sizesInStock: Array<{ size: string; stock: number }>;
}

interface Bucket {
  products: number;
  pieces: number;
  costValue: number;
}

interface StagnantData {
  lines: StagnantLine[];
  buckets: { d30: Bucket; d60: Bucket; d90: Bucket };
  windowDays: number;
}

const MIN_DAYS = [
  [30, "30+ dias"],
  [60, "60+ dias"],
  [90, "90+ dias"],
] as const;

const ROW_GRID = "lg:grid-cols-[minmax(0,1fr)_minmax(0,260px)_72px_120px_150px]";

function stoppedFor(line: StagnantLine, windowDays: number): string {
  if (line.lastSaleAt) return `sem venda há ${formatDays(line.days)} · última em ${formatStoreDate(new Date(line.lastSaleAt))}`;
  if (line.noSaleInWindow) return `nenhuma venda em ${windowDays} dias`;
  return `cadastrado há ${formatDays(line.days)}, ainda sem venda`;
}

export function StagnantStockReport() {
  const [minDays, setMinDays] = useState<30 | 60 | 90>(30);
  const { data, loading, error } = useReport<StagnantData>("/api/reports/stagnant");
  const lines = (data?.lines ?? []).filter((line) => line.days >= minDays);
  const buckets = data?.buckets;
  const tiedUp = lines.reduce((sum, line) => sum + line.costValue, 0);
  const pieces = lines.reduce((sum, line) => sum + line.stock, 0);

  const bucketHint = (bucket?: Bucket) => (bucket ? `${bucket.products} produtos · ${bucket.pieces} peças` : undefined);

  return (
    <div className="space-y-6">
      <TotalsStrip
        items={[
          { label: "Parado há 30–59 dias", value: loading ? "…" : formatCurrency(buckets?.d30.costValue ?? 0), hint: bucketHint(buckets?.d30) },
          { label: "Parado há 60–89 dias", value: loading ? "…" : formatCurrency(buckets?.d60.costValue ?? 0), hint: bucketHint(buckets?.d60) },
          { label: "Parado há 90+ dias", value: loading ? "…" : formatCurrency(buckets?.d90.costValue ?? 0), tone: "debt", hint: bucketHint(buckets?.d90) },
        ]}
      />

      <section aria-labelledby="stagnant">
        <ReportHeading
          id="stagnant"
          note={data ? `Valores pelo custo · considera as vendas dos últimos ${data.windowDays} dias` : undefined}
        >
          Estoque parado
        </ReportHeading>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <ChoiceRow label="Sem venda há" options={MIN_DAYS} value={minDays} onChange={(v) => setMinDays(v as 30 | 60 | 90)} />
          {!loading && !error ? (
            <p className="text-sm text-ink-2">
              <b className="font-semibold tabular-nums text-ink">{lines.length}</b> produtos ·{" "}
              <b className="font-semibold tabular-nums text-ink">{pieces}</b> peças ·{" "}
              <b className="font-semibold tabular-nums text-vermelho">{formatCurrency(tiedUp)}</b> parados
            </p>
          ) : null}
        </div>
        <ReportState
          loading={loading}
          error={error}
          empty={!loading && !error && lines.length === 0}
          emptyText="Nenhum produto parado nesse prazo: tudo o que tem estoque vendeu recentemente."
        />
        {!loading && !error && lines.length > 0 ? (
          <>
            <TagHeader className={cn("hidden lg:grid lg:gap-x-4", ROW_GRID)}>
              <span>Produto</span>
              <span>Tamanhos em estoque</span>
              <span className="text-right">Peças</span>
              <span className="text-right">Custo parado</span>
              <span className="text-right">Venderia por</span>
            </TagHeader>
            <ul className="space-y-2">
              {lines.map((line) => (
                <li key={line.productId}>
                  <TagRow className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2", ROW_GRID)}>
                    <div className="flex min-w-0 items-center gap-3">
                      <ProductPhoto src={line.image} name={line.name} className="h-11 w-11" />
                      <div className="min-w-0">
                        <p className="line-clamp-2 font-semibold leading-snug">{line.name}</p>
                        <p className={cn("text-xs", line.days >= 90 ? "text-vermelho" : "text-ink-3")}>{stoppedFor(line, data?.windowDays ?? 180)}</p>
                      </div>
                    </div>
                    <p className="text-right font-tag text-xl font-extrabold tabular-nums text-vermelho lg:hidden">{formatCurrency(line.costValue)}</p>
                    <div className="col-span-2 lg:col-span-1">
                      {line.sizesInStock.length > 0 ? (
                        <SizeGrid sizes={line.sizesInStock} size="sm" />
                      ) : (
                        <span className="text-sm text-ink-3">Sem grade</span>
                      )}
                    </div>
                    <p className="col-span-2 text-sm text-ink-2 lg:hidden">
                      {line.stock} {line.stock === 1 ? "peça" : "peças"} · venderia por {formatCurrency(line.saleValue)}
                    </p>
                    <p className="hidden text-right tabular-nums lg:block">{line.stock}</p>
                    <p className="hidden text-right font-tag text-xl font-extrabold tabular-nums text-vermelho lg:block">{formatCurrency(line.costValue)}</p>
                    <p className="hidden text-right tabular-nums text-ink-2 lg:block">{formatCurrency(line.saleValue)}</p>
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
