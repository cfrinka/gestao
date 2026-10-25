import { cn } from "@/lib/utils";

export interface TotalsItem {
  label: string;
  value: React.ReactNode;
  tone?: "neutral" | "positive" | "debt" | "info";
  hint?: React.ReactNode;
}

const toneClass = {
  neutral: "text-ink",
  positive: "text-verde",
  debt: "text-vermelho",
  info: "text-denim",
} as const;

/**
 * A screen's running totals on one strip of card stock, divided by printed rules.
 * Figures, not tiles: one line of label, one line of number.
 */
export function TotalsStrip({ items, className }: { items: TotalsItem[]; className?: string }) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 border border-rule bg-paper sm:flex sm:flex-wrap",
        className
      )}
    >
      {items.map((item, i) => (
        <div
          key={item.label}
          className={cn(
            "min-w-0 px-4 py-2.5 sm:min-w-[140px] sm:flex-1 sm:border-l sm:border-rule sm:first:border-l-0",
            i % 2 === 1 && "border-l border-rule sm:border-l",
            i >= 2 && "border-t border-rule sm:border-t-0",
            items.length % 2 === 1 && i === items.length - 1 && "col-span-2 border-l-0"
          )}
        >
          <dt className="truncate text-sm text-ink-2" title={item.label}>{item.label}</dt>
          <dd className={cn("mt-0.5 font-tag text-[22px] font-bold leading-tight tabular-nums", toneClass[item.tone ?? "neutral"])}>
            {item.value}
          </dd>
          {item.hint ? <dd className="mt-1 text-xs text-ink-3">{item.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
