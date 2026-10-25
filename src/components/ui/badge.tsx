import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Printed label: square, outlined or inverse, condensed caps.
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-tag text-xs font-bold uppercase leading-4 tracking-[0.06em]",
  {
    variants: {
      variant: {
        default: "border-ink bg-ink text-white",
        secondary: "border-rule-strong bg-paper text-ink-2",
        destructive: "border-vermelho bg-vermelho-tint text-vermelho",
        outline: "border-ink bg-paper text-ink",
        positive: "border-verde/40 bg-verde-tint text-verde",
        info: "border-denim/40 bg-denim-tint text-denim",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
