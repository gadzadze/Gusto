"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { connectRsAction, disconnectRsAction } from "@/app/supplier/settings/rs-actions";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";

const KNOWN = ["disabled", "not_owner", "not_connected", "invalid_credentials", "wrong_company", "rs_unreachable", "rs_rejected", "rate_limited"];

/** Connect or disconnect the company's RS.ge service user (owner only). The password never comes back to the page. */
export function RsConnection({ connected, verified, canManage }: { connected: boolean; verified: string; canManage: boolean }) {
  const t = useTranslations("waybill.rs");
  const [pending, startTransition] = useTransition();
  const [su, setSu] = useState("");
  const [sp, setSp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fail = (code: string) => t(`errors.${(KNOWN.includes(code) ? code : "unknown") as "unknown"}`);

  return (
    <section aria-labelledby="rs-connect" className="max-w-2xl space-y-3 glass p-4">
      <h2 id="rs-connect" className="font-semibold">{t("connect.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("connect.intro")}</p>
      <p className="text-xs text-muted-foreground">{t("connect.ipNote")}</p>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {connected ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium">{t("connect.connected", { date: verified })}</p>
          {canManage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const result = await disconnectRsAction();
                  if (!result.ok) setError(fail(result.error));
                })
              }
            >
              {t("connect.disconnect")}
            </Button>
          ) : null}
        </div>
      ) : canManage ? (
        <form
          className="space-y-3"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await connectRsAction({ su, sp });
              if (result.ok) {
                setSu("");
                setSp("");
              } else setError(fail(result.error));
            });
          }}
        >
          <Field id="rs-su" label={t("connect.user")}>
            <Input id="rs-su" value={su} onChange={(e) => setSu(e.target.value)} autoComplete="off" required />
          </Field>
          <Field id="rs-sp" label={t("connect.password")}>
            <Input id="rs-sp" type="password" value={sp} onChange={(e) => setSp(e.target.value)} autoComplete="new-password" required />
          </Field>
          <Button type="submit" disabled={pending || !su || !sp}>{t("connect.submit")}</Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{t("connect.ownerOnly")}</p>
      )}
    </section>
  );
}
