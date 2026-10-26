"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** Loads one report endpoint; reloads when the URL changes. */
export function useReport<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet(url)
      .then((result) => alive && setData(result as T))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Erro ao carregar o relatório"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [url]);

  return { data, loading, error };
}

/** Section heading in the report's printed-label voice. */
export function ReportHeading({ id, children, note }: { id: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id={id} className="font-tag text-lg font-bold uppercase tracking-[0.04em] text-ink">
        {children}
      </h2>
      {note ? <p className="text-sm text-ink-3">{note}</p> : null}
    </div>
  );
}

/** A row of mutually exclusive choices (period basis, minimum age…), same look as the period presets. */
export function ChoiceRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      <span className="text-sm text-ink-2">{label}</span>
      {options.map(([option, text]) => (
        <button
          key={String(option)}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "inline-flex h-9 items-center border px-3 text-sm font-semibold transition-colors",
            value === option ? "border-ink bg-ink text-white" : "border-rule-strong bg-paper text-ink hover:border-ink"
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function ReportState({ loading, error, empty, emptyText }: { loading: boolean; error: string | null; empty: boolean; emptyText: string }) {
  if (loading) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-14 animate-pulse bg-paper" />
        ))}
      </div>
    );
  }
  if (error) return <p className="border border-vermelho/40 bg-vermelho-tint px-4 py-3 text-sm text-vermelho">{error}</p>;
  if (empty) return <p className="border border-rule bg-paper px-4 py-6 text-center text-sm text-ink-2">{emptyText}</p>;
  return null;
}

/** The size label boxed the way it is printed on the hang tag. */
export function SizeBox({ size }: { size: string }) {
  return (
    <span className="inline-flex h-8 min-w-[2rem] items-center justify-center border-[1.5px] border-ink bg-paper px-1.5 font-tag text-sm font-bold uppercase tracking-[0.04em] text-ink">
      {size}
    </span>
  );
}

export function formatDays(days: number): string {
  return days === 1 ? "1 dia" : `${days} dias`;
}
