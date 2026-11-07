"use client";

import { useLocale, useTranslations } from "next-intl";
import { useOptimistic, useTransition } from "react";
import { setLocaleAction } from "@/app/locale-actions";
import { FlagGB, FlagGE } from "@/components/flags";
import { LOCALES, type Locale } from "@/i18n/locales";
import { cn } from "@/lib/utils";

// Each language is named in itself, so it can be found whatever language the page is in.
const NAMES: Record<Locale, { short: string; name: string; Flag: typeof FlagGE }> = {
  ka: { short: "KA", name: "ქართული", Flag: FlagGE },
  en: { short: "EN", name: "English", Flag: FlagGB },
};

/**
 * The language choice: two flags. It reacts at once (the chosen flag lights up and the page dims)
 * while the new language loads from the server, so the click never feels ignored.
 */
export function LocaleSwitch({ className, variant = "app" }: { className?: string; variant?: "app" | "landing" }) {
  const t = useTranslations("common");
  const current = useLocale() as Locale;
  const [shown, setShown] = useOptimistic(current);
  const [pending, startTransition] = useTransition();

  const choose = (next: Locale) => {
    if (next === shown || pending) return;
    startTransition(async () => {
      setShown(next);
      document.documentElement.dataset.switching = "1";
      try {
        await setLocaleAction(next);
        document.documentElement.lang = next;
      } finally {
        delete document.documentElement.dataset.switching;
      }
    });
  };

  return (
    <div
      role="group"
      aria-label={t("language")}
      aria-busy={pending}
      className={cn(variant === "landing" ? "locale-switch" : "inline-flex rounded-lg border border-border p-0.5", className)}
    >
      {LOCALES.map((locale) => {
        const { Flag, short, name } = NAMES[locale];
        const on = shown === locale;
        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            aria-pressed={on}
            aria-label={name}
            title={name}
            onClick={() => choose(locale)}
            className={
              variant === "landing"
                ? on
                  ? "on"
                  : undefined
                : cn(
                    "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground md:min-h-8",
                    on && "bg-accent text-accent-foreground",
                  )
            }
          >
            <Flag className="h-3.5 w-5 shrink-0 rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.15)]" />
            <span>{short}</span>
          </button>
        );
      })}
    </div>
  );
}
