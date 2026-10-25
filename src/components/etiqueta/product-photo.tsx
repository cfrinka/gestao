"use client";

import { useState } from "react";
import { Shirt } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProductPhotoProps {
  src?: string;
  name: string;
  className?: string;
}

/**
 * Every product photo at one square scale on one neutral ground,
 * so items compare at a glance. No photo, or a broken one, shows the
 * same quiet placeholder instead of an unrelated picture.
 */
export function ProductPhoto({ src, name, className = "h-12 w-12" }: ProductPhotoProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={cn(
        "relative flex flex-shrink-0 items-center justify-center overflow-hidden bg-sub",
        className
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Shirt className="h-1/2 w-1/2 text-ink-3/50" strokeWidth={1.5} aria-hidden="true" />
      )}
    </div>
  );
}
