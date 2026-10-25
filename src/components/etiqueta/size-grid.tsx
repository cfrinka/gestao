"use client";

import { cn } from "@/lib/utils";

/** At or below this many pieces, stock prints in the debt colour. One threshold, everywhere. */
export const LOW_STOCK = 2;

export interface SizeStock {
  size: string;
  stock: number;
}

interface SizeGridProps {
  sizes: SizeStock[];
  /** When set, each size becomes a button that picks it (PDV, trocas). */
  onPick?: (size: string) => void;
  /** Sizes already in the cart or chosen, printed inverse. */
  selected?: string[];
  /** Stock at or below this prints in the debt colour. */
  lowAt?: number;
  /** "responsive": compact on phones, full size from lg up. */
  size?: "sm" | "md" | "responsive";
  className?: string;
  productName?: string;
  /** Sold-out sizes can still be picked (a returned piece in a troca). */
  pickEmpty?: boolean;
}

/**
 * The hang tag's size grid: boxed sizes joined by printed rules,
 * stock under each. Sold-out sizes fade; low stock prints red.
 */
export function SizeGrid({
  sizes,
  onPick,
  selected = [],
  lowAt = LOW_STOCK,
  size = "md",
  className,
  productName,
  pickEmpty = false,
}: SizeGridProps) {
  if (!sizes || sizes.length === 0) return null;

  const cell = {
    sm: "min-w-[34px] h-[34px] px-1 text-[15px]",
    md: "min-w-[44px] h-[44px] px-1.5 text-[17px]",
    responsive: "min-w-[38px] h-[38px] px-1 text-[16px] lg:min-w-[44px] lg:h-[44px] lg:px-1.5 lg:text-[17px]",
  }[size];

  return (
    <div
      className={cn(
        "inline-flex max-w-full flex-wrap border-[1.5px] border-ink bg-paper",
        className
      )}
      role={onPick ? "group" : undefined}
      aria-label={onPick && productName ? `Tamanhos de ${productName}` : undefined}
    >
      {sizes.map((s, i) => {
        const out = s.stock <= 0;
        const low = !out && s.stock <= lowAt;
        const isSelected = selected.includes(s.size);
        const content = (
          <>
            <span className="font-tag font-bold leading-none">{s.size}</span>
            <span
              className={cn(
                "mt-0.5 text-[11px] font-semibold leading-none tabular-nums",
                isSelected ? "text-white/80" : low ? "text-vermelho" : "text-ink-3",
                out && !isSelected && "text-ink-3/60"
              )}
            >
              {s.stock}
            </span>
          </>
        );
        const base = cn(
          "flex flex-col items-center justify-center",
          cell,
          i > 0 && "border-l-[1.5px] border-ink",
          isSelected ? "bg-ink text-white" : out ? "bg-sub text-ink-3/60" : "text-ink"
        );

        if (!onPick) {
          return (
            <span key={s.size} className={base} title={`${s.size}: ${s.stock} em estoque`}>
              {content}
            </span>
          );
        }

        return (
          <button
            key={s.size}
            type="button"
            disabled={out && !pickEmpty}
            onClick={(e) => {
              e.stopPropagation();
              onPick(s.size);
            }}
            aria-label={
              out && !pickEmpty
                ? `Tamanho ${s.size} esgotado`
                : `Adicionar tamanho ${s.size}, ${s.stock} em estoque`
            }
            className={cn(
              base,
              "transition-colors duration-100 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-denim focus-visible:ring-offset-1",
              (!out || pickEmpty) && !isSelected && "hover:bg-denim hover:text-white [&:hover_span]:text-white",
              out && !pickEmpty && "cursor-not-allowed"
            )}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
