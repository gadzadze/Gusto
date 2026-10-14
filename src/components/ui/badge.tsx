import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium [&_svg]:size-3.5",
  {
    variants: {
      tone: {
        neutral: "bg-[var(--status-gray-bg)] text-[var(--status-gray-fg)]",
        amber: "bg-[var(--status-amber-bg)] text-[var(--status-amber-fg)]",
        blue: "bg-[var(--status-blue-bg)] text-[var(--status-blue-fg)]",
        green: "bg-[var(--status-green-bg)] text-[var(--status-green-fg)]",
        brand: "bg-brand-soft text-brand",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
