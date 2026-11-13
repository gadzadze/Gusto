"use client";

import { Check, Copy, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { ConnectInstead, type FoundBusiness } from "@/components/connections/connect-instead";
import { findBusinessAction } from "@/app/connections/actions";
import { createSupplierInviteAction, type SupplierInviteLinks } from "@/app/buyer/suppliers/invite/actions";
import type { ValidationKey } from "@/lib/validation/form-errors";

export function InviteSupplierForm() {
  const t = useTranslations("supplierInvite");
  const [pending, startTransition] = useTransition();
  const [links, setLinks] = useState<SupplierInviteLinks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, ValidationKey>>({});
  const [copied, setCopied] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [match, setMatch] = useState<FoundBusiness | null>(null);

  async function create(values: { supplierName: string; phone: string; email: string; legalId: string }, form: HTMLFormElement | null) {
    const result = await createSupplierInviteAction(values);
    if (result.ok) {
      setLinks(result.links);
      form?.reset();
    } else if (result.error === "invalid" && result.fieldErrors) {
      setFieldErrors(result.fieldErrors as Record<string, ValidationKey>);
    } else {
      setError(known.includes(result.error) ? t(`errors.${result.error as "invalid"}`) : t("errors.unknown"));
    }
  }

  const known = ["not_active", "too_many_open", "stale_status", "rate_limited", "invalid"];

  return (
    <div className="space-y-5">
      <form
        ref={formRef}
        className="grid max-w-xl gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const values = {
            supplierName: String(data.get("supplierName") ?? ""),
            phone: String(data.get("phone") ?? ""),
            email: String(data.get("email") ?? ""),
            legalId: String(data.get("legalId") ?? ""),
          };
          setError(null);
          setFieldErrors({});
          setLinks(null);
          setCopied(false);
          setMatch(null);
          startTransition(async () => {
            // A code that belongs to a supplier already on 202: offer a request instead of a link.
            if (values.legalId.trim()) {
              const lookup = await findBusinessAction(values.legalId);
              if (lookup.ok && lookup.result.state === "found") return setMatch(lookup.result);
              if (!lookup.ok && lookup.error === "invalid_code") return setFieldErrors({ legalId: "invalid_legal_id" as ValidationKey });
            }
            await create(values, form);
          });
        }}
      >
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <Field id="supplierName" label={t("name")} error={fieldErrors.supplierName}>
          <Input id="supplierName" name="supplierName" autoComplete="off" required />
        </Field>
        <Field id="phone" label={t("phone")} hint={t("contactHint")} error={fieldErrors.phone} optional>
          <Input id="phone" name="phone" type="tel" autoComplete="off" />
        </Field>
        <Field id="email" label={t("email")} error={fieldErrors.email} optional>
          <Input id="email" name="email" type="email" autoComplete="off" />
        </Field>
        <Field id="legalId" label={t("legalId")} hint={t("legalIdHint")} error={fieldErrors.legalId} optional>
          <Input id="legalId" name="legalId" inputMode="numeric" autoComplete="off" />
        </Field>
        {match ? (
          <ConnectInstead
            match={match}
            onBack={() => setMatch(null)}
            onLink={() => {
              const form = formRef.current;
              if (!form) return;
              const data = new FormData(form);
              setMatch(null);
              startTransition(async () => {
                await create(
                  {
                    supplierName: String(data.get("supplierName") ?? ""),
                    phone: String(data.get("phone") ?? ""),
                    email: String(data.get("email") ?? ""),
                    legalId: String(data.get("legalId") ?? ""),
                  },
                  form,
                );
              });
            }}
          />
        ) : null}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </div>
      </form>

      {links ? (
        <div className="max-w-xl space-y-4 rounded-xl border border-brand/30 bg-brand-soft/40 p-5">
          <div>
            <h2 className="font-semibold">{t("panel.title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("panel.expires")} {t("panel.once")}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={links.inviteUrl} aria-label={t("panel.title")} onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(links.inviteUrl);
                setCopied(true);
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? t("panel.copied") : t("panel.copy")}
            </Button>
          </div>
          {links.whatsappUrl ? (
            <div className="space-y-1">
              <Button asChild>
                <a href={links.whatsappUrl} target="_blank" rel="noopener noreferrer">
                  <MessageCircle />
                  {t("panel.whatsapp")}
                </a>
              </Button>
              <p className="text-sm text-muted-foreground">{t("panel.whatsappNote")}</p>
            </div>
          ) : null}
          {links.emailSent === false ? <FormAlert tone="error">{t("panel.emailNotSent")}</FormAlert> : null}
        </div>
      ) : null}
    </div>
  );
}
