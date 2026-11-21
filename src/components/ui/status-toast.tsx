"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A short status message that floats above the bottom bar. It stays until the person closes it: a message that
 * disappears on a timer can be gone before someone using a screen reader or who reads slowly has finished it.
 */
export function StatusToast({
  icon,
  children,
  onDismiss,
  className,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onDismiss: () => void;
  className?: string;
}) {
  const t = useTranslations("common");
  return (
    <div role="status" aria-live="polite" className={cn("pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-6", className)}>
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-border bg-surface py-1 pl-4 pr-1 text-sm font-medium shadow-lg">
        {icon}
        <span className="min-w-0">{children}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("dismiss")}
          title={t("dismiss")}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}
