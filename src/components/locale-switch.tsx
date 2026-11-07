"use client";

import { useTranslations } from "next-intl";
import { FlagGB, FlagGE } from "@/components/flags";
import { useLocaleSwitch } from "@/i18n/client-intl";
import { LOCALES, type Locale } from "@/i18n/locales";
import { cn } from "@/lib/utils";

// Each language is named in itself, so it can be found whatever language the page is in.
const NAMES: Record<Locale, { short: string; name: string; Flag: typeof FlagGE }> = {
  ka: { short: "KA", name: "ქართული", Flag: FlagGE },
  en: { short: "EN", name: "English", Flag: FlagGB },
};

/** The language choice: two flags. It switches in the browser at once (see i18n/client-intl.tsx). */
export function LocaleSwitch({ className, variant = "app" }: { className?: string; variant?: "app" | "landing" }) {
  const t = useTranslations("common");
  const { locale, syncing, switchTo } = useLocaleSwitch();

  return (
    <div
      role="group"
      aria-label={t("language")}
      aria-busy={syncing}
      className={cn(variant === "landing" ? "locale-switch" : "inline-flex rounded-lg border border-border p-0.5", className)}
    >
      {LOCALES.map((option) => {
        const { Flag, short, name } = NAMES[option];
        const on = locale === option;
        return (
          <button
            key={option}
            type="button"
            lang={option}
            aria-pressed={on}
            aria-label={name}
            title={name}
            onClick={() => switchTo(option)}
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
