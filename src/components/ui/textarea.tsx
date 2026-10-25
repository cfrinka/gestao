import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-sm border border-input bg-paper px-3 py-2 text-sm text-ink transition-colors placeholder:text-ink-3 hover:border-ink-2 focus-visible:border-denim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-denim disabled:cursor-not-allowed disabled:bg-sub disabled:opacity-60",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
