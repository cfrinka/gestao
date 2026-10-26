"use client";

import { useState } from "react";
import { TotalsStrip } from "@/components/etiqueta/totals-strip";
import { cn, formatCurrency } from "@/lib/utils";
import { formatStoreDate } from "@/lib/dates";
import { ChoiceRow, ReportHeading, ReportState, useReport } from "./report-shared";

interface Cell {
  hour: number;
  sales: number;
  revenue: number;
}

interface InsightsData {
  periodDays: number;
  totals: { sales: number; revenue: number; pieces: number; gross: number; discount: number; avgTicket: number; piecesPerSale: number };
  heatmap: {
    hours: number[];
    days: Array<{ weekday: number; label: string; cells: Cell[]; sales: number; revenue: number }>;
    byHour: Array<{ hour: number; sales: number }>;
    maxCellSales: number;
    busiestDay: { label: string; sales: number; revenue: number } | null;
    busiestHour: { hour: number; sales: number } | null;
  };
  sellers: Array<{
    sellerId: string;
    name: string;
    sales: number;
    revenue: number;
    pieces: number;
    avgTicket: number;
    piecesPerSale: number;
    discount: number;
    discountShare: number;
  }>;
  discounts: {
    gross: number;
    discount: number;
    share: number;
    salesWithDiscount: number;
    salesWithDiscountShare: number;
    promo: number;
    manual: number;
    unsplit: number;
    bands: Array<{ label: string; sales: number; discount: number }>;
  };
  categories: Array<{ category: string; pieces: number; revenue: number; cost: number; margin: number; marginRate: number; share: number }>;
  customers: {
    salesWithPhone: number;
    salesWithPhoneShare: number;
    identified: number;
    returning: number;
    top: Array<{ phone: string; name: string | null; sales: number; revenue: number; lastAt: string | null }>;
  };
}

const PERIODS = [
  [30, "30 dias"],
  [90, "90 dias"],
  [180, "180 dias"],
] as const;

const DAY_NAMES: Record<string, string> = {
  Seg: "Segunda",
  Ter: "Terça",
  Qua: "Quarta",
  Qui: "Quinta",
  Sex: "Sexta",
  Sáb: "Sábado",
  Dom: "Domingo",
};

/** Five steps of denim over card stock: one hue, light to dark, for "how many sales". */
const HEAT_STEPS = [0, 16, 34, 54, 76, 100];

function heatLevel(sales: number, max: number): number {
  if (sales <= 0 || max <= 0) return 0;
  return Math.max(1, Math.ceil((sales / max) * 5));
}

function heatStyle(level: number): React.CSSProperties | undefined {
  if (level === 0) return undefined;
  return { backgroundColor: `color-mix(in oklab, hsl(var(--denim)) ${HEAT_STEPS[level]}%, hsl(var(--paper)))` };
}

/** A discount printed with its leading minus; nothing to take off prints as plain zero. */
const minus = (value: number) => (value > 0.004 ? `−${formatCurrency(value)}` : formatCurrency(0));

const percent = (value: number) => `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const hourLabel = (hour: number) => `${hour}h`;

function Heatmap({ data }: { data: InsightsData["heatmap"] }) {
  const [focus, setFocus] = useState<{ day: string; cell: Cell } | null>(null);
  if (data.hours.length === 0) return null;

  return (
    <div className="space-y-3">
      <p className="min-h-[1.25rem] text-sm text-ink-2" aria-live="polite">
        {focus ? (
          <>
            <b className="font-semibold text-ink">
              {DAY_NAMES[focus.day]} · {hourLabel(focus.cell.hour)} às {hourLabel(focus.cell.hour + 1)}
            </b>{" "}
            · <b className="font-semibold tabular-nums text-ink">{focus.cell.sales}</b> {focus.cell.sales === 1 ? "venda" : "vendas"} ·{" "}
            <b className="font-semibold tabular-nums text-ink">{formatCurrency(focus.cell.revenue)}</b>
          </>
        ) : (
          "Passe o mouse ou use Tab sobre um horário para ver o faturamento."
        )}
      </p>
      <div className="overflow-x-auto border border-rule bg-paper">
        <table className="w-full border-collapse text-sm tabular-nums">
          <caption className="sr-only">Vendas por dia da semana e hora</caption>
          <thead>
            <tr>
              <th scope="col" className="w-12 px-2 py-2" />
              {data.hours.map((hour) => (
                <th key={hour} scope="col" className="px-1 py-2 text-center font-tag text-xs font-bold uppercase tracking-[0.08em] text-ink-2">
                  {hourLabel(hour)}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-tag text-xs font-bold uppercase tracking-[0.08em] text-ink-2">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {data.days.map((day) => (
              <tr key={day.label} className="border-t border-rule">
                <th scope="row" className="px-2 py-1.5 text-left font-tag text-sm font-bold uppercase tracking-[0.04em] text-ink">
                  {day.label}
                </th>
                {day.cells.map((cell) => {
                  const level = heatLevel(cell.sales, data.maxCellSales);
                  return (
                    <td key={cell.hour} className="p-[2px]">
                      <div
                        tabIndex={cell.sales > 0 ? 0 : -1}
                        role="img"
                        aria-label={`${DAY_NAMES[day.label]}, ${hourLabel(cell.hour)}: ${cell.sales} vendas, ${formatCurrency(cell.revenue)}`}
                        onPointerEnter={() => setFocus({ day: day.label, cell })}
                        onFocus={() => setFocus({ day: day.label, cell })}
                        className={cn(
                          "flex h-9 min-w-[36px] items-center justify-center text-[13px] font-semibold outline-none transition-shadow hover:ring-[1.5px] hover:ring-ink focus-visible:ring-2 focus-visible:ring-ink",
                          level === 0 ? "text-ink-3/60" : level >= 4 ? "text-white" : "text-ink"
                        )}
                        style={heatStyle(level)}
                      >
                        {cell.sales > 0 ? cell.sales : ""}
                      </div>
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-right text-ink-2">{formatCurrency(day.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-xs text-ink-3" aria-hidden="true">
        <span>Menos vendas</span>
        {HEAT_STEPS.slice(1).map((_, i) => (
          <span key={i} className="h-3 w-6 border border-rule" style={heatStyle(i + 1)} />
        ))}
        <span>Mais</span>
      </div>
    </div>
  );
}

export function SalesInsightsReport() {
  const [days, setDays] = useState<30 | 90 | 180>(30);
  const { data, loading, error } = useReport<InsightsData>(`/api/reports/sales-insights?days=${days}`);
  const ready = !loading && !error && data;
  const empty = Boolean(ready && data.totals.sales === 0);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <ChoiceRow label="Vendas dos últimos" options={PERIODS} value={days} onChange={(v) => setDays(v as 30 | 90 | 180)} />
        <TotalsStrip
          items={[
            { label: "Vendas", value: loading ? "…" : data?.totals.sales ?? 0, hint: loading ? null : `${data?.totals.pieces ?? 0} peças` },
            { label: "Faturamento", value: loading ? "…" : formatCurrency(data?.totals.revenue ?? 0) },
            { label: "Ticket médio", value: loading ? "…" : formatCurrency(data?.totals.avgTicket ?? 0) },
            { label: "Peças por venda", value: loading ? "…" : (data?.totals.piecesPerSale ?? 0).toLocaleString("pt-BR") },
            {
              label: "Descontos",
              value: loading ? "…" : formatCurrency(data?.totals.discount ?? 0),
              tone: "positive",
              hint: loading || !data ? null : `${percent(data.discounts.share)} do preço cheio`,
            },
          ]}
        />
      </div>

      <ReportState loading={loading} error={error} empty={empty} emptyText="Nenhuma venda no período." />

      {ready && !empty ? (
        <>
          <section aria-labelledby="when">
            <ReportHeading
              id="when"
              note={
                data.heatmap.busiestDay && data.heatmap.busiestHour
                  ? `Dia mais forte: ${DAY_NAMES[data.heatmap.busiestDay.label]} (${formatCurrency(data.heatmap.busiestDay.revenue)}) · horário com mais vendas: ${hourLabel(data.heatmap.busiestHour.hour)}`
                  : undefined
              }
            >
              Dias e horários
            </ReportHeading>
            <Heatmap data={data.heatmap} />
          </section>

          <section aria-labelledby="sellers">
            <ReportHeading id="sellers" note="Quem registrou a venda no PDV">
              Por vendedor
            </ReportHeading>
            <div className="overflow-x-auto border border-rule bg-paper">
              <table className="w-full min-w-[640px] text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-ink/80 font-tag text-xs font-bold uppercase tracking-[0.08em] text-ink-2">
                    <th scope="col" className="px-4 py-2 text-left">Vendedor</th>
                    <th scope="col" className="px-3 py-2 text-right">Vendas</th>
                    <th scope="col" className="px-3 py-2 text-right">Faturamento</th>
                    <th scope="col" className="px-3 py-2 text-right">Ticket médio</th>
                    <th scope="col" className="px-3 py-2 text-right">Peças por venda</th>
                    <th scope="col" className="px-4 py-2 text-right">Desconto dado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sellers.map((seller) => (
                    <tr key={seller.sellerId} className="border-b border-rule last:border-b-0">
                      <th scope="row" className="px-4 py-2.5 text-left font-semibold text-ink">{seller.name}</th>
                      <td className="px-3 py-2.5 text-right">{seller.sales}</td>
                      <td className="px-3 py-2.5 text-right">{formatCurrency(seller.revenue)}</td>
                      <td className="px-3 py-2.5 text-right font-tag text-lg font-bold">{formatCurrency(seller.avgTicket)}</td>
                      <td className="px-3 py-2.5 text-right">{seller.piecesPerSale.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-2.5 text-right">
                        {formatCurrency(seller.discount)} <span className="text-ink-3">({percent(seller.discountShare)})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="discounts">
            <ReportHeading id="discounts" note={`${data.discounts.salesWithDiscount} de ${data.totals.sales} vendas tiveram desconto (${percent(data.discounts.salesWithDiscountShare)})`}>
              O que os descontos custaram
            </ReportHeading>
            <div className="grid gap-4 lg:grid-cols-2">
              <dl className="divide-y divide-rule border border-rule bg-paper text-sm">
                <div className="flex items-baseline justify-between px-4 py-2.5">
                  <dt className="text-ink-2">Preço cheio das vendas</dt>
                  <dd className="tabular-nums">{formatCurrency(data.discounts.gross)}</dd>
                </div>
                <div className="flex items-baseline justify-between px-4 py-2.5">
                  <dt className="text-ink-2">Descontos automáticos da loja</dt>
                  <dd className={cn("tabular-nums", data.discounts.promo > 0 ? "text-verde" : "text-ink-3")}>{minus(data.discounts.promo)}</dd>
                </div>
                <div className="flex items-baseline justify-between px-4 py-2.5">
                  <dt className="text-ink-2">Descontos dados no caixa</dt>
                  <dd className={cn("tabular-nums", data.discounts.manual > 0 ? "text-verde" : "text-ink-3")}>{minus(data.discounts.manual)}</dd>
                </div>
                {data.discounts.unsplit > 0 ? (
                  <div className="flex items-baseline justify-between px-4 py-2.5">
                    <dt className="text-ink-2">
                      Sem detalhe <span className="text-xs text-ink-3">(vendas anteriores a esta atualização)</span>
                    </dt>
                    <dd className="tabular-nums text-verde">{minus(data.discounts.unsplit)}</dd>
                  </div>
                ) : null}
                <div className="flex items-baseline justify-between border-t-2 border-ink px-4 py-2.5 font-semibold">
                  <dt>Total em descontos</dt>
                  <dd className="font-tag text-xl font-extrabold tabular-nums text-verde">
                    {minus(data.discounts.discount)} <span className="text-sm font-semibold">({percent(data.discounts.share)})</span>
                  </dd>
                </div>
              </dl>
              <div className="border border-rule bg-paper px-4 py-3">
                <p className="mb-2 font-tag text-xs font-bold uppercase tracking-[0.08em] text-ink-2">Tamanho do desconto por venda</p>
                <ul className="space-y-2 text-sm">
                  {data.discounts.bands.map((band) => {
                    const width = data.totals.sales > 0 ? (band.sales / data.totals.sales) * 100 : 0;
                    return (
                      <li key={band.label} className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3">
                        <span className="text-ink-2">{band.label}</span>
                        <span className="h-2 bg-sub" aria-hidden="true">
                          <span className="block h-2 bg-denim" style={{ width: `${width}%` }} />
                        </span>
                        <span className="tabular-nums text-ink">
                          {band.sales} {band.sales === 1 ? "venda" : "vendas"}
                          {band.discount > 0 ? <span className="text-ink-3"> · {formatCurrency(band.discount)}</span> : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </section>

          <section aria-labelledby="categories">
            <ReportHeading id="categories" note="Faturamento já com os descontos de cada venda">
              Por categoria
            </ReportHeading>
            <div className="overflow-x-auto border border-rule bg-paper">
              <table className="w-full min-w-[640px] text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-ink/80 font-tag text-xs font-bold uppercase tracking-[0.08em] text-ink-2">
                    <th scope="col" className="px-4 py-2 text-left">Categoria</th>
                    <th scope="col" className="px-3 py-2 text-right">Peças</th>
                    <th scope="col" className="px-3 py-2 text-left">Parte do faturamento</th>
                    <th scope="col" className="px-3 py-2 text-right">Faturamento</th>
                    <th scope="col" className="px-4 py-2 text-right">Margem</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categories.map((line) => (
                    <tr key={line.category} className="border-b border-rule last:border-b-0">
                      <th scope="row" className="px-4 py-2.5 text-left font-semibold text-ink">{line.category}</th>
                      <td className="px-3 py-2.5 text-right">{line.pieces}</td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-full max-w-[160px] bg-sub" aria-hidden="true">
                            <span className="block h-2 bg-denim" style={{ width: `${line.share * 100}%` }} />
                          </span>
                          <span className="w-12 text-right text-ink-2">{percent(line.share)}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">{formatCurrency(line.revenue)}</td>
                      <td className={cn("px-4 py-2.5 text-right", line.margin < 0 && "text-vermelho")}>
                        {formatCurrency(line.margin)} <span className="text-ink-3">({percent(line.marginRate)})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="customers">
            <ReportHeading
              id="customers"
              note={
                data.customers.salesWithPhone > 0
                  ? `${data.customers.salesWithPhone} vendas com celular (${percent(data.customers.salesWithPhoneShare)}) · ${data.customers.returning} de ${data.customers.identified} clientes voltaram`
                  : undefined
              }
            >
              Clientes que voltam
            </ReportHeading>
            {data.customers.top.length === 0 ? (
              <p className="border border-rule bg-paper px-4 py-6 text-center text-sm text-ink-2">
                Nenhuma venda com celular no período. Anote o celular do cliente no PDV (campo opcional no pagamento) para ver quem volta.
              </p>
            ) : (
              <ul className="divide-y divide-rule border border-rule bg-paper">
                {data.customers.top.map((customer) => (
                  <li key={customer.phone} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{customer.name ?? customer.phone}</p>
                      <p className="text-xs text-ink-3">
                        {customer.name ? `${customer.phone} · ` : ""}
                        {customer.sales} {customer.sales === 1 ? "compra" : "compras"}
                        {customer.lastAt ? ` · última em ${formatStoreDate(new Date(customer.lastAt))}` : ""}
                      </p>
                    </div>
                    <p className="font-tag text-xl font-extrabold tabular-nums text-ink">{formatCurrency(customer.revenue)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
