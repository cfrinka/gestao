"use client";

import { useState } from "react";
import { Shirt } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProductPhotoProps {
  src?: string;
  name: string;
  className?: string;
  /** Largest size the photo is shown at, in CSS pixels; picks the thumbnail width. */
  displaySize?: number;
}

// Widths the image server is allowed to produce (next.config.mjs → images.imageSizes).
const THUMB_WIDTHS = [64, 96, 128, 192, 256, 384];
const RESIZABLE_HOSTS = new Set(["storage.googleapis.com", "firebasestorage.googleapis.com"]);

/**
 * Photos in the store's bucket are camera originals; they are requested through the image
 * server at roughly twice the displayed size (sharp on high-density screens) instead of the
 * multi-megabyte file. Photos from anywhere else are shown as they are.
 */
export function thumbnailUrl(src: string, displaySize: number): string {
  try {
    const url = new URL(src);
    if (!RESIZABLE_HOSTS.has(url.hostname)) return src;
  } catch {
    return src;
  }
  const wanted = displaySize * 2;
  const width = THUMB_WIDTHS.find((w) => w >= wanted) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=70`;
}

/**
 * Every product photo at one square scale on one neutral ground,
 * so items compare at a glance. No photo, or a broken one, shows the
 * same quiet placeholder instead of an unrelated picture.
 */
export function ProductPhoto({ src, name, className = "h-12 w-12", displaySize = 56 }: ProductPhotoProps) {
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
          src={thumbnailUrl(src as string, displaySize)}
          alt={name}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Shirt className="h-1/2 w-1/2 text-ink-3/50" strokeWidth={1.5} aria-hidden="true" />
      )}
    </div>
  );
}
