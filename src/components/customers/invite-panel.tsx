"use client";

import { Check, Copy, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import type { InviteLinks } from "@/app/supplier/customers/actions";

/** Shows a freshly created invitation link once: copy, send on WhatsApp. */
export function InvitePanel({ links }: { links: InviteLinks }) {
  const t = useTranslations("customers.invite");
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-4 rounded-xl border border-brand/30 bg-brand-soft/40 p-5">
      <div>
        <h2 className="font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("expires")} {t("once")}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input readOnly value={links.inviteUrl} aria-label={t("title")} onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(links.inviteUrl);
            setCopied(true);
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
      {links.whatsappUrl ? (
        <div className="space-y-1">
          <Button asChild>
            <a href={links.whatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle />
              {t("whatsapp")}
            </a>
          </Button>
          <p className="text-sm text-muted-foreground">{t("whatsappNote")}</p>
        </div>
      ) : null}
      {links.emailSent === false ? <FormAlert tone="error">{t("emailNotSent")}</FormAlert> : null}
    </div>
  );
}
