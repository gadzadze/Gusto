"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { clearTermsAction, decideTermsAction } from "@/app/supplier/pricing/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { formatBp, type PaymentMethod } from "@/lib/pricing/conditions";

export type TermsRequestCard = {
  id: string;
  method: PaymentMethod | null;
  intervalDays: number | null;
  fromBp: number;
  toBp: number;
  /** Price now and after, formatted on the server. */
  samples: { name: string; now: string; after: string }[];
};

/**
 * The payment terms of one customer. A customer's request shows what it would change (the percentage and
 * a few example prices); the supplier approves or declines. Nothing changes before approval.
 */
export function CustomerTerms({
  buyerName,
  current,
  request,
  readOnly,
  buyerOrgId,
}: {
  buyerName: string;
  buyerOrgId: string;
  current: { method: PaymentMethod | null; intervalDays: number | null };
  request: TermsRequestCard | null;
  readOnly: boolean;
}) {
  const t = useTranslations("customers.terms");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label = (m: PaymentMethod | null, days: number | null) => {
    const parts = [m ? t(`method.${m}`) : null, days === null ? null : days === 0 ? t("onDelivery") : t("days", { count: days })].filter(Boolean);
    return parts.length ? parts.join(", ") : t("standard");
  };
  const hasTerms = current.method !== null || current.intervalDays !== null;

  function run(action: () => ReturnType<typeof decideTermsAction>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(t(`errors.${result.error === "request_not_pending" ? "request_not_pending" : "unknown"}`));
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-border p-4" aria-labelledby="customer-terms-title">
      <h2 id="customer-terms-title" className="font-semibold">{t("title")}</h2>
      <p className="text-sm">{t("current", { terms: label(current.method, current.intervalDays) })}</p>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {request ? (
        <div className="space-y-3 rounded-lg border border-brand/30 bg-brand-soft/40 p-4">
          <p className="font-medium">{t("requestTitle")}</p>
          <p className="text-sm">{t("requestBody", { buyer: buyerName, terms: label(request.method, request.intervalDays) })}</p>
          <p className="text-sm font-semibold">{t("changeLine", { from: formatBp(request.fromBp), to: formatBp(request.toBp) })}</p>
          {request.samples.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("sampleTitle")}</p>
              <ul className="space-y-1 text-sm">
                {request.samples.map((s) => (
                  <li key={s.name} className="flex justify-between gap-4">
                    <span className="truncate">{s.name}</span>
                    <span className="whitespace-nowrap tabular-nums"><span className="text-muted-foreground line-through">{s.now}</span> {s.after}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={readOnly || pending} onClick={() => run(() => decideTermsAction(request.id, true))}>{t("approve")}</Button>
            <Button variant="outline" disabled={readOnly || pending} onClick={() => run(() => decideTermsAction(request.id, false))}>{t("decline")}</Button>
          </div>
        </div>
      ) : null}
      {hasTerms ? (
        <Button variant="outline" size="sm" disabled={readOnly || pending} onClick={() => run(() => clearTermsAction(buyerOrgId))}>
          {t("reset")}
        </Button>
      ) : null}
    </section>
  );
}
