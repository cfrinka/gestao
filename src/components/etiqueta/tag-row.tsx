import { cn } from "@/lib/utils";

/**
 * One product on its hang tag: notched left end with the eyelet punched
 * through, white card stock. Lays out its children on the grid it is given.
 */
export function TagRow({
  className,
  children,
  faded = false,
}: {
  className?: string;
  children: React.ReactNode;
  faded?: boolean;
}) {
  return (
    <div className={cn("tag-shape relative bg-paper py-2.5 pl-7 pr-3 sm:pr-4", faded && "opacity-60", className)}>
      <span
        aria-hidden="true"
        className="absolute left-[9px] top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full bg-ground"
      />
      {children}
    </div>
  );
}

/** Column labels printed above a list of tag rows, on the same grid. */
export function TagHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pb-2 pl-7 pr-4 font-tag text-xs font-bold uppercase tracking-[0.08em] text-ink-2",
        className
      )}
    >
      {children}
    </div>
  );
}
