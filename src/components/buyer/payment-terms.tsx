"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { requestTermsAction } from "@/app/buyer/suppliers/[id]/terms-actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatBp, type PaymentMethod } from "@/lib/pricing/conditions";

export type TermsView = {
  supplierOrgId: string;
  supplierName: string;
  current: { method: PaymentMethod | null; intervalDays: number | null };
  pending: { method: PaymentMethod | null; intervalDays: number | null } | null;
  lastDeclined: boolean;
  methods: { method: PaymentMethod; adjustBp: number }[];
  intervals: { days: number; adjustBp: number }[];
  /** "from 10 kg: -5%", already formatted on the server. */
  tiers: string[];
};

const NONE = "";

/** The conditions a supplier offers, and the form to ask for a payment method and interval. */
export function PaymentTerms({ view }: { view: TermsView }) {
  const t = useTranslations("buyer.terms");
  const [pending, startTransition] = useTransition();
  const wanted = view.pending ?? view.current;
  const [method, setMethod] = useState<string>(wanted.method ?? NONE);
  const [interval, setInterval] = useState<string>(wanted.intervalDays === null ? NONE : String(wanted.intervalDays));
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const label = (m: PaymentMethod | null, days: number | null) => {
    const parts = [m ? t(`method.${m}`) : null, days === null ? null : days === 0 ? t("onDelivery") : t("days", { count: days })].filter(Boolean);
    return parts.length ? parts.join(", ") : t("standard");
  };
  const sameAsAgreed = (method || null) === view.current.method && (interval === NONE ? null : Number(interval)) === view.current.intervalDays;
  const sameAsPending = view.pending !== null && (method || null) === view.pending.method && (interval === NONE ? null : Number(interval)) === view.pending.intervalDays;

  if (view.methods.length === 0 && view.intervals.length === 0 && view.tiers.length === 0) return null;

  return (
    <section className="space-y-3 rounded-xl border border-border p-4" aria-labelledby="terms-title">
      <h2 id="terms-title" className="font-semibold">{t("title")}</h2>
      <p className="text-sm text-muted-foreground">{t("intro", { supplier: view.supplierName })}</p>

      {view.tiers.length > 0 ? (
        <div className="text-sm">
          <p className="font-medium">{t("tiersTitle")}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
            {view.tiers.map((tier) => (<li key={tier}>{tier}</li>))}
          </ul>
        </div>
      ) : null}

      {view.methods.length > 0 || view.intervals.length > 0 ? (
        <>
          <p className="text-sm font-medium">
            {view.current.method || view.current.intervalDays !== null ? t("current", { terms: label(view.current.method, view.current.intervalDays) }) : t("currentStandard")}
          </p>
          {view.pending ? <FormAlert tone="warning">{t("pending", { supplier: view.supplierName, terms: label(view.pending.method, view.pending.intervalDays) })}</FormAlert> : null}
          {!view.pending && view.lastDeclined ? <FormAlert tone="warning">{t("declined")}</FormAlert> : null}
          {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {view.methods.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="terms-method">{t("methodLabel")}</Label>
                <Select id="terms-method" value={method} onChange={(event) => setMethod(event.target.value)}>
                  <option value={NONE}>{t("standard")}</option>
                  {view.methods.map((m) => (<option key={m.method} value={m.method}>{t(`method.${m.method}`)} ({formatBp(m.adjustBp)})</option>))}
                </Select>
              </div>
            ) : null}
            {view.intervals.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="terms-interval">{t("intervalLabel")}</Label>
                <Select id="terms-interval" value={interval} onChange={(event) => setInterval(event.target.value)}>
                  <option value={NONE}>{t("standard")}</option>
                  {view.intervals.map((i) => (<option key={i.days} value={String(i.days)}>{i.days === 0 ? t("onDelivery") : t("days", { count: i.days })} ({formatBp(i.adjustBp)})</option>))}
                </Select>
              </div>
            ) : null}
          </div>
          <Button
            disabled={pending || sameAsPending || (view.pending === null && sameAsAgreed)}
            onClick={() => {
              setMessage(null);
              startTransition(async () => {
                const result = await requestTermsAction({
                  supplierOrgId: view.supplierOrgId,
                  method: method === NONE ? null : method,
                  intervalDays: interval === NONE ? null : Number(interval),
                });
                setMessage(
                  result.ok
                    ? { tone: "success", text: t("sent", { supplier: view.supplierName }) }
                    : { tone: "error", text: t(`errors.${result.error === "not_offered" || result.error === "rate_limited" ? result.error : "unknown"}`) },
                );
              });
            }}
          >
            {t("send")}
          </Button>
        </>
      ) : null}
    </section>
  );
}
