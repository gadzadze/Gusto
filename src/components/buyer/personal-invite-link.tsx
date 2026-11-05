"use client";

import { Check, Copy, RefreshCw, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { personalLinkAction, type PersonalLink } from "@/app/buyer/suppliers/invite/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";

/** The buyer's reusable link: copy it, or hand it to WhatsApp (or any app) with the ready text. */
export function PersonalInviteLink({ initial }: { initial: PersonalLink | null }) {
  const t = useTranslations("supplierInvite.personal");
  const [link, setLink] = useState<PersonalLink | null>(initial);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState<"text" | "link" | null>(null);
  const [pending, startTransition] = useTransition();

  const load = (regenerate: boolean) =>
    startTransition(async () => {
      const result = await personalLinkAction(regenerate);
      setError(!result.ok);
      if (result.ok) {
        setLink(result.link);
        setCopied(null);
      }
    });

  // First visit: make the link without asking for another tap.
  useEffect(() => {
    if (!initial) load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async (what: "text" | "link") => {
    if (!link) return;
    await navigator.clipboard.writeText(what === "text" ? link.text : link.url);
    setCopied(what);
  };

  const share = async () => {
    if (!link) return;
    // The phone's share sheet lists WhatsApp chats; where it doesn't exist, copy the text instead.
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text: link.text });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    await copy("text");
  };

  return (
    <section className="max-w-xl space-y-4 rounded-xl border border-brand/30 bg-brand-soft/40 p-5" aria-labelledby="personal-link-heading">
      <div>
        <h2 id="personal-link-heading" className="font-semibold">
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("body")}</p>
      </div>
      {error ? <FormAlert tone="error">{t("error")}</FormAlert> : null}
      {link ? (
        <>
          <p className="rounded-md bg-surface px-3 py-2 text-sm leading-6 text-muted-foreground" data-testid="personal-link-text">
            {link.text}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={share}>
              <Share2 />
              {t("share")}
            </Button>
            <Button type="button" variant="outline" onClick={() => copy("text")}>
              {copied === "text" ? <Check /> : <Copy />}
              {copied === "text" ? t("copied") : t("copyText")}
            </Button>
            <Button type="button" variant="outline" onClick={() => copy("link")}>
              {copied === "link" ? <Check /> : <Copy />}
              {copied === "link" ? t("copied") : t("copyLink")}
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => load(true)}>
            <RefreshCw />
            {t("regenerate")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("regenerateNote")}</p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("preparing")}</p>
      )}
    </section>
  );
}
