"use client";

import { Check, Copy, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { createSupplierInviteAction, type SupplierInviteLinks } from "@/app/buyer/suppliers/invite/actions";
import type { ValidationKey } from "@/lib/validation/form-errors";

export function InviteSupplierForm() {
  const t = useTranslations("supplierInvite");
  const [pending, startTransition] = useTransition();
  const [links, setLinks] = useState<SupplierInviteLinks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, ValidationKey>>({});
  const [copied, setCopied] = useState(false);
  const [copiedText, setCopiedText] = useState(false);

  const known = ["not_active", "too_many_open", "stale_status", "rate_limited", "invalid"];

  return (
    <div className="space-y-5">
      <form
        className="grid max-w-xl gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          setError(null);
          setFieldErrors({});
          setLinks(null);
          setCopied(false);
          setCopiedText(false);
          startTransition(async () => {
            const result = await createSupplierInviteAction({
              supplierName: String(data.get("supplierName") ?? ""),
              phone: String(data.get("phone") ?? ""),
              email: String(data.get("email") ?? ""),
            });
            if (result.ok) {
              setLinks(result.links);
              form.reset();
            } else if (result.error === "invalid" && result.fieldErrors) {
              setFieldErrors(result.fieldErrors as Record<string, ValidationKey>);
            } else {
              setError(known.includes(result.error) ? t(`errors.${result.error as "invalid"}`) : t("errors.unknown"));
            }
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
          <div className="space-y-1">
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(links.orderText);
                setCopiedText(true);
              }}
            >
              {copiedText ? <Check /> : <Copy />}
              {copiedText ? t("panel.copied") : t("panel.copyText")}
            </Button>
            <p className="text-sm text-muted-foreground">{t("panel.copyTextNote")}</p>
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
