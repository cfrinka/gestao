import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  /** One line of live state or a fact that changes how the screen reads. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  /** Keep the actions on the title line on phones (a single short action). */
  inlineActions?: boolean;
  className?: string;
}

/**
 * The screen's top bar: the title in tag print, its live state,
 * and the screen's actions locked to the right edge.
 * Bleeds to the edges of the main column and stays put while it scrolls.
 */
export function PageHeader({ title, meta, actions, inlineActions = false, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "sticky -top-3 z-20 -mx-3 -mt-3 mb-4 border-b border-rule bg-paper sm:-top-4 sm:-mx-4 sm:-mt-4 md:-top-6 md:-mx-6 md:-mt-6 md:mb-6",
        className
      )}
    >
      <div className="flex min-h-[64px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 sm:px-4 md:px-6">
        <h1 className="font-tag text-[26px] font-extrabold uppercase leading-none tracking-[0.02em] text-ink md:text-[28px]">
          {title}
        </h1>
        {meta ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
            {meta}
          </div>
        ) : null}
        {actions ? (
          <div className={cn("flex flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end", inlineActions ? "ml-auto" : "w-full")}>
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

interface StateTagProps {
  tone?: "open" | "closed" | "neutral" | "debt";
  children: React.ReactNode;
}

/** A bordered tag for a screen's live state, e.g. "Caixa aberto · 09:12". */
export function StateTag({ tone = "neutral", children }: StateTagProps) {
  const dot = {
    open: "bg-verde",
    closed: "bg-ink-3",
    neutral: "bg-ink",
    debt: "bg-vermelho",
  }[tone];
  return (
    <span className="inline-flex items-center gap-2 border-[1.5px] border-ink bg-paper px-2.5 py-1 text-sm font-semibold text-ink">
      <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden="true" />
      {children}
    </span>
  );
}
