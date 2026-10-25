import { cn } from "@/lib/utils";

const brl = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface PriceTagProps {
  value: number;
  className?: string;
  /** Prefix a minus sign (discounts, sangria). */
  negative?: boolean;
}

/**
 * A price set the way the tag prints it: condensed numerals,
 * the currency raised small beside them.
 */
export function PriceTag({ value, className, negative = false }: PriceTagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline whitespace-nowrap font-tag font-extrabold leading-none tabular-nums",
        className
      )}
    >
      <span className="sr-only">{negative ? "menos " : ""}R$ {brl.format(value)}</span>
      <span aria-hidden="true" className="contents">
        {negative ? <span className="mr-[0.08em]">−</span> : null}
        <span className="mr-[0.12em] self-start text-[0.48em] leading-[1.15]">R$</span>
        {brl.format(value)}
      </span>
    </span>
  );
}
