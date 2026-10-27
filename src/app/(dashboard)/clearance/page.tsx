"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgePercent, Printer } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { cn, formatCurrency } from "@/lib/utils";
import { roundMoney } from "@/lib/money";
import { addDaysISO, todayISO } from "@/lib/dates";
import { loadPdf } from "@/lib/pdf";
import { useToast } from "@/components/ui/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/layout/page-header";
import { TotalsStrip } from "@/components/etiqueta/totals-strip";
import { TagHeader, TagRow } from "@/components/etiqueta/tag-row";
import { ProductPhoto } from "@/components/etiqueta/product-photo";
import { SizeGrid } from "@/components/etiqueta/size-grid";
import { PriceTag } from "@/components/etiqueta/price-tag";
import { ChoiceRow, ReportHeading, ReportState } from "@/components/reports/report-shared";
import { niceDown, percentForPrice, type ClearanceCandidate, type ClearanceInProgress } from "@/domains/clearance/clearance";

interface ClearanceData {
  windowDays: number;
  today: string;
  candidates: ClearanceCandidate[];
  newArrivals: number;
  totals: { products: number; pieces: number; costValue: number; saleValue: number };
  inProgress: ClearanceInProgress[];
}

const WINDOWS = [
  [30, "30 dias"],
  [60, "60 dias"],
  [90, "90 dias"],
] as const;

const ROW_GRID = "lg:grid-cols-[24px_minmax(0,1fr)_minmax(0,220px)_128px_96px_176px]";

/** "2026-11-09" → "09/11/2026", without a trip through a time zone. */
function formatDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function formatPercent(value: number): string {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/** A price as typed in Brazil: "19,90". */
function toInput(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

function parsePrice(raw: string | undefined): number {
  if (!raw) return NaN;
  return roundMoney(Number(raw.replace(/\s/g, "").replace(",", ".")));
}

function stoppedFor(line: ClearanceCandidate): string {
  if (line.noSaleInLookback) {
    return line.daysWithoutSale > 365 ? "Sem venda há mais de 1 ano" : `Nunca vendeu · cadastrado há ${line.daysWithoutSale} dias`;
  }
  return `Última venda há ${line.daysWithoutSale} dias`;
}

export default function ClearancePage() {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [days, setDays] = useState<30 | 60 | 90>(30);
  const [data, setData] = useState<ClearanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [endsAt, setEndsAt] = useState(() => addDaysISO(todayISO(), 14));
  const [bulkPercent, setBulkPercent] = useState("30");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await apiGet(`/api/clearance?days=${days}`)) as ClearanceData;
      setData(result);
      // Each product starts at the suggested price (or the clearance price it already has);
      // prices already typed on this screen are kept.
      setPrices((typed) => {
        const next: Record<string, string> = {};
        for (const line of result.candidates) {
          const start = line.current?.price ?? line.suggestedPrice;
          next[line.productId] = typed[line.productId] ?? (start ? toInput(start) : "");
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar a liquidação");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const candidates = useMemo(() => data?.candidates ?? [], [data]);
  const inProgress = data?.inProgress ?? [];

  const rowState = (line: ClearanceCandidate) => {
    const price = parsePrice(prices[line.productId]);
    const valid = Number.isFinite(price) && price > 0 && price < line.salePrice;
    return {
      price,
      valid,
      percent: valid ? percentForPrice(line.salePrice, price) : null,
      belowCost: valid && price < line.costPrice,
    };
  };

  const chosen = candidates.filter((line) => selected.has(line.productId));
  const invalidChosen = chosen.filter((line) => !rowState(line).valid);
  const summary = chosen.reduce(
    (sum, line) => {
      const { price, valid } = rowState(line);
      return {
        pieces: sum.pieces + line.stock,
        full: roundMoney(sum.full + line.stock * line.salePrice),
        clearance: roundMoney(sum.clearance + line.stock * (valid ? price : line.salePrice)),
      };
    },
    { pieces: 0, full: 0, clearance: 0 }
  );

  const toggle = (productId: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(productId);
      else next.delete(productId);
      return next;
    });

  const allSelected = candidates.length > 0 && candidates.every((line) => selected.has(line.productId));

  const setPrice = (productId: string, value: string) => {
    setPrices((current) => ({ ...current, [productId]: value }));
    toggle(productId, true);
  };

  const applyBulkPercent = () => {
    const percent = Number(bulkPercent.replace(",", "."));
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
      toast({ title: "Informe um desconto entre 1% e 99%", variant: "destructive" });
      return;
    }
    setPrices((current) => {
      const next = { ...current };
      for (const line of chosen) next[line.productId] = toInput(niceDown(line.salePrice * (1 - percent / 100)));
      return next;
    });
  };

  const useSuggestions = () =>
    setPrices((current) => {
      const next = { ...current };
      for (const line of chosen) if (line.suggestedPrice) next[line.productId] = toInput(line.suggestedPrice);
      return next;
    });

  const handleApply = async () => {
    if (chosen.length === 0) return;
    if (invalidChosen.length > 0) {
      toast({
        title: "Confira os preços",
        description: `${invalidChosen.length} produto${invalidChosen.length === 1 ? "" : "s"} sem preço de liquidação válido (abaixo do preço atual).`,
        variant: "destructive",
      });
      return;
    }
    const today = data?.today ?? todayISO();
    if (endsAt && endsAt < today) {
      toast({ title: "A data final precisa ser hoje ou depois", variant: "destructive" });
      return;
    }
    const belowCost = chosen.filter((line) => rowState(line).belowCost).length;
    const ok = await confirm({
      title: `Colocar ${chosen.length} produto${chosen.length === 1 ? "" : "s"} em liquidação?`,
      description:
        (endsAt ? `O desconto vale de hoje até ${formatDay(endsAt)}` : "O desconto vale a partir de hoje, sem data final") +
        " e já sai no PDV." +
        (belowCost > 0 ? ` ${belowCost} ${belowCost === 1 ? "fica" : "ficam"} abaixo do custo.` : ""),
      confirmLabel: "Aplicar liquidação",
    });
    if (!ok) return;

    setSaving(true);
    try {
      await apiPost("/api/clearance", {
        action: "apply",
        items: chosen.map((line) => ({ productId: line.productId, price: rowState(line).price })),
        endsAt: endsAt || null,
      });
      toast({ title: "Liquidação aplicada", description: "Os novos preços já valem no PDV." });
      setSelected(new Set());
      await load();
    } catch (e) {
      toast({ title: "Erro ao aplicar", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const printSelection = async () => {
    if (chosen.length === 0) return;
    const { jsPDF, autoTable } = await loadPdf();
    const doc = new jsPDF();
    const today = data?.today ?? todayISO();

    doc.setFontSize(18);
    doc.text("Sugestões de Liquidação", 14, 20);
    doc.setFontSize(10);
    doc.text(`Data: ${formatDay(today)}`, 14, 28);

    const rows = chosen.map((line) => {
      const state = rowState(line);
      return [
        line.name,
        line.sku,
        String(line.stock),
        formatCurrency(line.costPrice),
        formatCurrency(line.salePrice),
        state.valid ? formatCurrency(state.price) : "-",
        state.valid ? formatPercent(state.percent ?? 0) : "-",
      ];
    });

    autoTable(doc, {
      startY: 36,
      head: [["Produto", "SKU", "Estoque", "Custo", "Preço", "Liquidação", "Desconto"]],
      body: rows,
      theme: "grid",
      styles: { fontSize: 9 },
      headStyles: { fillColor: [245, 245, 245], textColor: 20 },
      columnStyles: {
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
      },
    });

    doc.save(`sugestoes-liquidacao-${today}.pdf`);
  };

  const handleEnd = async (line: ClearanceInProgress) => {
    const ended = line.status === "encerrada";
    const ok = await confirm({
      title: ended ? `Tirar ${line.name} da lista?` : `Encerrar a liquidação de ${line.name}?`,
      description: ended ? "A data final já passou; o produto já está no preço normal." : "O produto volta ao preço normal no PDV.",
      confirmLabel: ended ? "Tirar da lista" : "Encerrar",
      danger: !ended,
    });
    if (!ok) return;
    try {
      await apiPost("/api/clearance", { action: "end", productIds: [line.productId] });
      toast({ title: ended ? "Retirado da lista" : "Liquidação encerrada" });
      await load();
    } catch (e) {
      toast({ title: "Erro ao encerrar", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div className={cn("space-y-6", chosen.length > 0 && "pb-56 md:pb-28")}>
      <PageHeader
        title="Liquidação"
        meta={<span>Produtos com estoque que não venderam no período. Você escolhe o preço final.</span>}
      />

      <div className="space-y-3">
        <ChoiceRow label="Sem venda nos últimos" options={WINDOWS} value={days} onChange={(v) => setDays(v as 30 | 60 | 90)} />
        <TotalsStrip
          items={[
            {
              label: "Produtos parados",
              value: loading ? "…" : data?.totals.products ?? 0,
              hint: !loading && data?.newArrivals ? `${data.newArrivals} cadastrados no período ficaram de fora` : undefined,
            },
            { label: "Peças", value: loading ? "…" : data?.totals.pieces ?? 0 },
            { label: "Custo parado", value: loading ? "…" : formatCurrency(data?.totals.costValue ?? 0), tone: "debt" },
            { label: "Venderiam por", value: loading ? "…" : formatCurrency(data?.totals.saleValue ?? 0) },
          ]}
        />
      </div>

      {inProgress.length > 0 ? (
        <section aria-labelledby="in-progress">
          <ReportHeading id="in-progress" note="Vendas contadas desde o primeiro dia do desconto">
            Em liquidação
          </ReportHeading>
          <ul className="divide-y divide-rule border border-rule bg-paper">
            {inProgress.map((line) => (
              <li key={line.productId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_200px_auto]">
                <div className="flex min-w-0 items-center gap-3">
                  <ProductPhoto src={line.image} name={line.name} className="h-11 w-11" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{line.name}</span>
                      {line.status === "ativa" ? (
                        <Badge variant="positive">Ativa</Badge>
                      ) : line.status === "agendada" ? (
                        <Badge variant="info">Agendada</Badge>
                      ) : (
                        <Badge variant="secondary">Encerrada</Badge>
                      )}
                    </p>
                    <p className="text-sm text-ink-2">
                      {line.soldSinceStart} vendida{line.soldSinceStart === 1 ? "" : "s"}
                      {line.startsAt ? ` desde ${formatDay(line.startsAt)}` : ""} · {line.stock} em estoque
                      {line.endsAt ? ` · até ${formatDay(line.endsAt)}` : " · sem data final"}
                    </p>
                  </div>
                </div>
                <p className="text-right tabular-nums sm:order-none">
                  <span className="mr-2 text-sm text-ink-3 line-through">{formatCurrency(line.salePrice)}</span>
                  <PriceTag value={line.price} className="text-2xl text-verde" />
                  <span className="block text-xs text-verde">−{formatPercent(line.discountPercent)}</span>
                </p>
                <Button variant="danger" size="sm" className="col-span-2 justify-self-end sm:col-span-1" onClick={() => handleEnd(line)}>
                  {line.status === "encerrada" ? "Tirar da lista" : "Encerrar"}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="stopped">
        <ReportHeading id="stopped" note={`Sem nenhuma venda nos últimos ${days} dias, do mais parado para o menos`}>
          O que não vendeu
        </ReportHeading>

        <ReportState
          loading={loading}
          error={error}
          empty={!loading && !error && candidates.length === 0}
          emptyText={`Tudo o que está em estoque vendeu nos últimos ${days} dias.`}
        />

        {!loading && !error && candidates.length > 0 ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) => setSelected(checked === true ? new Set(candidates.map((line) => line.productId)) : new Set())}
                  aria-label="Selecionar todos"
                />
                Selecionar todos
              </label>
              {/* Always on screen, so selecting the first product doesn't push the list down. */}
              <div className={cn("flex flex-wrap items-center gap-2 text-sm text-ink-2", chosen.length === 0 && "opacity-60")}>
                <span>Nos selecionados:</span>
                <Button variant="outline" size="sm" onClick={useSuggestions} disabled={chosen.length === 0}>
                  Usar a sugestão
                </Button>
                <span>ou</span>
                <span className="inline-flex items-center gap-1.5">
                  <Input
                    aria-label="Desconto para os selecionados, em porcentagem"
                    inputMode="decimal"
                    value={bulkPercent}
                    onChange={(e) => setBulkPercent(e.target.value)}
                    disabled={chosen.length === 0}
                    className="h-9 w-16 text-right tabular-nums"
                  />
                  <span>%</span>
                </span>
                <Button variant="outline" size="sm" onClick={applyBulkPercent} disabled={chosen.length === 0}>
                  Aplicar a todos
                </Button>
              </div>
            </div>

            <TagHeader className={cn("hidden lg:grid lg:gap-x-4", ROW_GRID)}>
              <span />
              <span>Produto</span>
              <span>Tamanhos</span>
              <span className="text-right">Custo</span>
              <span className="text-right">Preço</span>
              <span className="text-right">Liquidação</span>
            </TagHeader>
            <ul className="space-y-2">
              {candidates.map((line) => {
                const isSelected = selected.has(line.productId);
                const state = rowState(line);
                const raw = prices[line.productId] ?? "";
                return (
                  <li key={line.productId}>
                    <TagRow
                      className={cn(
                        "grid grid-cols-[24px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 lg:gap-x-4",
                        ROW_GRID,
                        isSelected && "bg-denim-tint"
                      )}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => toggle(line.productId, checked === true)}
                        aria-label={`Selecionar ${line.name}`}
                      />
                      <div className="flex min-w-0 items-center gap-3">
                        <ProductPhoto src={line.image} name={line.name} className="h-11 w-11" />
                        <div className="min-w-0">
                          <p className="line-clamp-2 font-semibold leading-snug">{line.name}</p>
                          <p className="text-xs text-ink-3">
                            <span className="tracking-[0.04em]">{line.sku}</span> ·{" "}
                            <span className={line.daysWithoutSale >= 90 ? "text-vermelho" : undefined}>{stoppedFor(line)}</span>
                          </p>
                          {line.current ? (
                            <p className="text-xs text-verde">
                              Já em liquidação por {formatCurrency(line.current.price)}
                              {line.current.endsAt ? ` até ${formatDay(line.current.endsAt)}` : ""}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="col-start-2 lg:col-start-auto">
                        {line.sizesInStock.length > 0 ? (
                          <SizeGrid sizes={line.sizesInStock} size="sm" />
                        ) : (
                          <span className="text-sm text-ink-3">{line.stock} {line.stock === 1 ? "peça" : "peças"}</span>
                        )}
                      </div>
                      <p className="col-start-2 text-sm tabular-nums text-ink-2 lg:col-start-auto lg:text-right">
                        <span className="lg:hidden">Custo </span>
                        {formatCurrency(line.costPrice)}
                        <span className="lg:hidden"> · preço {formatCurrency(line.salePrice)}</span>
                      </p>
                      <p className="hidden text-right lg:block">
                        <PriceTag value={line.salePrice} className="text-xl" />
                      </p>
                      <div className="col-start-2 space-y-1 lg:col-start-auto">
                        <div className="flex items-center gap-2 lg:justify-end">
                          <span className="text-sm font-semibold text-ink-2">R$</span>
                          <Input
                            aria-label={`Preço de liquidação de ${line.name}`}
                            inputMode="decimal"
                            value={raw}
                            onChange={(e) => setPrice(line.productId, e.target.value)}
                            aria-invalid={raw.trim() !== "" && !state.valid}
                            className="h-9 w-24 text-right font-semibold tabular-nums"
                          />
                        </div>
                        <p className="text-xs lg:text-right">
                          {raw.trim() === "" ? (
                            <span className="text-ink-3">{line.suggestedPrice ? "" : "Margem pequena: sem sugestão"}</span>
                          ) : !state.valid ? (
                            <span className="text-vermelho">Precisa ficar abaixo de {formatCurrency(line.salePrice)}</span>
                          ) : (
                            <>
                              <span className="font-semibold text-verde">−{formatPercent(state.percent ?? 0)}</span>
                              {state.belowCost ? <span className="text-vermelho"> · abaixo do custo</span> : null}
                              {line.suggestedPrice && Math.abs(state.price - line.suggestedPrice) > 0.004 ? (
                                <span className="text-ink-3"> · sugerido {formatCurrency(line.suggestedPrice)}</span>
                              ) : null}
                            </>
                          )}
                        </p>
                      </div>
                    </TagRow>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </section>

      {chosen.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t-[1.5px] border-ink bg-paper md:left-[220px]">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3 px-3 py-3 sm:px-4 md:px-6">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                {chosen.length} produto{chosen.length === 1 ? "" : "s"} · {summary.pieces} peça{summary.pieces === 1 ? "" : "s"}
              </p>
              <p className="text-sm tabular-nums text-ink-2">
                De {formatCurrency(summary.full)} por <span className="font-semibold text-verde">{formatCurrency(summary.clearance)}</span>
                {invalidChosen.length > 0 ? <span className="text-vermelho"> · {invalidChosen.length} sem preço válido</span> : null}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="clearance-ends">Vale até</Label>
              <Input
                id="clearance-ends"
                type="date"
                min={data?.today}
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="h-9 w-40"
              />
            </div>
            <p className="max-w-[16rem] text-xs text-ink-3">Deixe a data em branco para o desconto valer até você encerrar.</p>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={() => setSelected(new Set())} disabled={saving}>
                Limpar seleção
              </Button>
              <Button variant="outline" onClick={printSelection} disabled={saving}>
                <Printer className="h-4 w-4" aria-hidden="true" />
                Imprimir seleção
              </Button>
              <Button onClick={handleApply} disabled={saving}>
                <BadgePercent className="h-4 w-4" aria-hidden="true" />
                {saving ? "Aplicando…" : "Aplicar liquidação"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDialog}
    </div>
  );
}
