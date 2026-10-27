import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The Gusto wordmark (traced vector, `public/brand/gusto-wordmark.svg`).
 * Size it with a height class; the width follows. In the app's dark theme the
 * burgundy would fail contrast, so it is drawn white there.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/gusto-wordmark.svg"
      alt="Gusto"
      width={85}
      height={24}
      unoptimized
      className={cn("h-7 w-auto dark:brightness-0 dark:invert", className)}
    />
  );
}
