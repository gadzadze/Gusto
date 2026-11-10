import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The 202 wordmark (Nunito ExtraBold 800 outlines, `public/brand/202-wordmark.svg`).
 * Size it with a height class; the width follows. In the app's dark theme the
 * burgundy would fail contrast, so it is drawn white there.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/202-wordmark.svg"
      alt="202"
      width={64}
      height={28}
      unoptimized
      className={cn("h-7 w-auto dark:brightness-0 dark:invert", className)}
    />
  );
}
