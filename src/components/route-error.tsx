"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Error state for a route segment. Next.js renders it when a page throws
 * (database down, unexpected bug) so people see a calm message with a retry
 * instead of a blank screen; the shell around it stays.
 */
export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common.errorBoundary");
  useEffect(() => {
    // Message and digest only: error objects can carry request details.
    console.error("[route error]", { message: error.message, digest: error.digest });
  }, [error]);
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted">
        <TriangleAlert aria-hidden className="size-5 text-muted-foreground" />
      </div>
      <p className="font-medium">{t("title")}</p>
      <p className="text-sm text-muted-foreground">{t("body")}</p>
      <Button onClick={reset}>{t("retry")}</Button>
      {error.digest ? <p className="text-xs text-muted-foreground">{t("reference", { digest: error.digest })}</p> : null}
    </div>
  );
}
