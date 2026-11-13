"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { sendConnectionRequestAction } from "@/app/connections/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import type { LookupResult } from "@/server/domain/connections/connections";

export type FoundBusiness = Extract<LookupResult, { state: "found" }>;

/**
 * Shown by the invitation forms when the identification code belongs to a business that is already on 202:
 * a connection request instead of a link. Nothing is created until a button is pressed.
 */
export function ConnectInstead({
  match,
  priceListId,
  onLink,
  onBack,
}: {
  match: FoundBusiness;
  /** The price list the supplier chose in the form, offered with the request. */
  priceListId?: string | null;
  onLink: () => void;
  onBack: () => void;
}) {
  const t = useTranslations("connections");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<null | "sent" | "connected">(null);
  const [error, setError] = useState<string | null>(null);

  function send() {
    setError(null);
    startTransition(async () => {
      const response = await sendConnectionRequestAction({ targetOrgId: match.orgId, priceListId: priceListId ?? null });
      if (response.ok) setDone(response.status);
      else setError(t(`errors.${response.error === "invalid" ? "unknown" : response.error}` as "errors.unknown"));
    });
  }

  return (
    <div className="max-w-xl space-y-3 rounded-xl border border-brand/30 bg-brand-soft/40 p-5" role="status">
      <p className="font-semibold">{t("instead.title", { name: match.name, city: match.city })}</p>
      {done ? (
        <FormAlert tone="success">{t(done === "sent" ? "send.sent" : "send.connected", { name: match.name })}</FormAlert>
      ) : match.relation === "none" ? (
        <>
          <p className="text-sm text-muted-foreground">{t("instead.body")}</p>
          {error ? <FormAlert tone="error">{error}</FormAlert> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={pending} onClick={send}>
              {t("instead.send")}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={onLink}>
              {t("instead.link")}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm">{t(`relation.${match.relation}` as "relation.connected")}</p>
      )}
      {done || match.relation !== "none" ? (
        <Button type="button" variant="ghost" onClick={onBack}>
          {t("instead.back")}
        </Button>
      ) : null}
    </div>
  );
}
