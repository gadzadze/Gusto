"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { setLocaleAction } from "@/app/locale-actions";
import { LOCALES, type Locale } from "@/i18n/locales";
import { cn } from "@/lib/utils";

// Each language is named in itself, so it can be found whatever language the page is in.
const NAMES: Record<Locale, { short: string; name: string }> = {
  ka: { short: "KA", name: "ქართული" },
  en: { short: "EN", name: "English" },
};

/** The language choice: a small two-way switch. Used on the landing page, sign-in and inside the app. */
export function LocaleSwitch({ className, variant = "app" }: { className?: string; variant?: "app" | "landing" }) {
  const t = useTranslations("common");
  const current = useLocale() as Locale;
  const [pending, startTransition] = useTransition();

  const choose = (next: Locale) => {
    if (next === current || pending) return;
    startTransition(async () => {
      await setLocaleAction(next);
      document.documentElement.lang = next;
    });
  };

  return (
    <div
      role="group"
      aria-label={t("language")}
      className={cn(variant === "landing" ? "locale-switch" : "inline-flex rounded-lg border border-border p-0.5", className)}
    >
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          aria-pressed={current === locale}
          aria-label={NAMES[locale].name}
          title={NAMES[locale].name}
          disabled={pending}
          onClick={() => choose(locale)}
          className={
            variant === "landing"
              ? current === locale
                ? "on"
                : undefined
              : cn(
                  "inline-flex min-h-9 min-w-9 items-center justify-center rounded-md px-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground md:min-h-8 md:min-w-8",
                  current === locale && "bg-accent text-accent-foreground",
                )
          }
        >
          {NAMES[locale].short}
        </button>
      ))}
    </div>
  );
}
