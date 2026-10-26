"use client";

import { MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TotalsStrip } from "@/components/etiqueta/totals-strip";
import { cn, formatCurrency } from "@/lib/utils";
import { formatStoreDate } from "@/lib/dates";
import { ReportHeading, ReportState, formatDays, useReport } from "./report-shared";

interface CollectionLine {
  clientId: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  owed: number;
  openPurchases: number;
  oldestOpenAt: string | null;
  daysOpen: number | null;
  lastPaymentAt: string | null;
}

interface CollectionData {
  lines: CollectionLine[];
  totals: { owed: number; clients: number; over60: number; over90: number };
}

/** A reminder the person reads and sends themselves from WhatsApp; nothing is sent from here. */
function reminderLink(line: CollectionLine): string | null {
  if (!line.whatsapp) return null;
  const firstName = line.name.trim().split(/\s+/)[0] || line.name;
  const text =
    `Olá, ${firstName}! Aqui é da Benê Brasil. Passando para lembrar que há ${formatCurrency(line.owed)} ` +
    `em aberto na loja. Quando puder, passe por aqui ou nos chame para combinarmos o pagamento. Até breve!`;
  return `https://wa.me/${line.whatsapp}?text=${encodeURIComponent(text)}`;
}

function ageBadge(days: number | null) {
  if (days === null) return <Badge variant="secondary">Sem data</Badge>;
  if (days > 60) return <Badge variant="destructive">Há {formatDays(days)}</Badge>;
  return <Badge variant="secondary">Há {formatDays(days)}</Badge>;
}

export function FiadoCollectionReport() {
  const { data, loading, error } = useReport<CollectionData>("/api/reports/fiado-collection");
  const lines = data?.lines ?? [];
  const withoutPhone = lines.filter((line) => !line.whatsapp).length;

  return (
    <div className="space-y-6">
      <TotalsStrip
        items={[
          { label: "Em aberto", value: loading ? "…" : formatCurrency(data?.totals.owed ?? 0), tone: "debt" },
          { label: "Clientes devendo", value: loading ? "…" : data?.totals.clients ?? 0 },
          { label: "Há mais de 60 dias", value: loading ? "…" : formatCurrency(data?.totals.over60 ?? 0), tone: "debt" },
          { label: "Há mais de 90 dias", value: loading ? "…" : formatCurrency(data?.totals.over90 ?? 0), tone: "debt" },
        ]}
      />

      <section aria-labelledby="collection">
        <ReportHeading id="collection" note="Do débito mais antigo para o mais novo">
          Quem cobrar
        </ReportHeading>
        {!loading && !error && withoutPhone > 0 ? (
          <p className="mb-3 border-l-[3px] border-denim bg-denim-tint px-3 py-2 text-sm text-ink">
            {withoutPhone === lines.length ? "Nenhum" : `${withoutPhone} de ${lines.length}`} cliente{withoutPhone === 1 ? "" : "s"} sem
            celular válido no cadastro. Com o celular em Clientes e fiado, o lembrete abre pronto no WhatsApp.
          </p>
        ) : null}
        <ReportState loading={loading} error={error} empty={!loading && !error && lines.length === 0} emptyText="Ninguém devendo. Todo o fiado está em dia." />
        {!loading && !error && lines.length > 0 ? (
          <ul className="divide-y divide-rule border border-rule bg-paper">
            {lines.map((line) => {
              const link = reminderLink(line);
              return (
                <li key={line.clientId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_140px_200px]">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{line.name}</span>
                      {ageBadge(line.daysOpen)}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-2">
                      {line.openPurchases > 0
                        ? `${line.openPurchases} compra${line.openPurchases === 1 ? "" : "s"} em aberto${
                            line.oldestOpenAt ? ` · a mais antiga em ${formatStoreDate(new Date(line.oldestOpenAt))}` : ""
                          }`
                        : "Saldo sem compra em aberto (ajuste manual)"}
                    </p>
                    <p className="text-xs text-ink-3">
                      {line.lastPaymentAt ? `Último pagamento em ${formatStoreDate(new Date(line.lastPaymentAt))}` : "Nenhum pagamento registrado"}
                      {line.phone ? ` · ${line.phone}` : ""}
                    </p>
                  </div>
                  <p className="text-right font-tag text-2xl font-extrabold tabular-nums text-vermelho">{formatCurrency(line.owed)}</p>
                  <div className="col-span-2 sm:col-span-1 sm:justify-self-end">
                    {link ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className={cn(
                          "inline-flex h-9 items-center gap-2 border-[1.5px] border-ink bg-paper px-3 text-sm font-semibold text-ink transition-colors hover:bg-sub"
                        )}
                      >
                        <MessageCircle className="h-4 w-4" aria-hidden="true" />
                        Lembrar no WhatsApp
                      </a>
                    ) : (
                      <span className="text-xs text-ink-3">Sem celular</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
