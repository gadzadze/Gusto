"use client";

import { Package } from "lucide-react";
import Image, { type ImageLoader } from "next/image";
import { productImageUrl } from "@/lib/catalog/product-image-url";
import { cn } from "@/lib/utils";

// Images are resized once at upload (400px and 1200px WebP), so a custom
// loader picks the stored size instead of running Next's image optimizer.
const loader: ImageLoader = ({ src, width }) => productImageUrl(src, width);

export function ProductImage({
  path,
  alt,
  size,
  className,
}: {
  path: string | null;
  alt: string;
  /** Rendered size in CSS pixels (square). */
  size: number;
  className?: string;
}) {
  if (!path) {
    return (
      <div
        aria-hidden
        style={{ width: size, height: size }}
        className={cn("flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", className)}
      >
        <Package className="size-1/3" />
      </div>
    );
  }
  return (
    <Image
      loader={loader}
      src={path}
      alt={alt}
      width={size}
      height={size}
      sizes={`${size}px`}
      className={cn("shrink-0 rounded-md bg-muted object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}
