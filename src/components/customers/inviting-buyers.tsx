"use client";

import { Handshake } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { connectInvitingBuyerAction } from "@/app/supplier/customers/actions";

export type InvitingBuyerRow = { inviteId: string; buyerName: string; invitedAt: string };

/** Buyers who invited this supplier to 202: one tap makes them a customer. */
export function InvitingBuyers({ rows, disabled }: { rows: InvitingBuyerRow[]; disabled?: boolean }) {
  const t = useTranslations("customers.invitingBuyers");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (rows.length === 0) return null;
  return (
    <section className="max-w-3xl space-y-3 rounded-xl border border-brand/30 bg-brand-soft/40 p-5">
      <div className="flex items-start gap-3">
        <Handshake aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
        <div>
          <h2 className="font-semibold">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("hint")}</p>
        </div>
      </div>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <ul className="divide-y divide-border rounded-lg border border-border bg-background">
        {rows.map((r) => (
          <li key={r.inviteId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{r.buyerName}</p>
              <p className="text-xs text-muted-foreground">{r.invitedAt}</p>
            </div>
            <Button
              size="sm"
              disabled={disabled || pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await connectInvitingBuyerAction(r.inviteId);
                  if (!result.ok) setError(t(`errors.${result.error === "already_connected" || result.error === "suspended" ? result.error : "unknown"}`));
                });
              }}
            >
              {pending ? t("adding") : t("add")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
