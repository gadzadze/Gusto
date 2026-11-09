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

/**
 * The language choice: one flag, the language in use. Tapping it switches to the other language (and
 * its flag) in the browser at once (see i18n/client-intl.tsx). The accessible name says where it goes.
 */
export function LocaleSwitch({ className, variant = "app" }: { className?: string; variant?: "app" | "landing" }) {
  const t = useTranslations("common");
  const { locale, syncing, switchTo } = useLocaleSwitch();
  const next = LOCALES.find((option) => option !== locale) ?? locale;
  const { Flag } = NAMES[locale];
  const target = NAMES[next].name;

  return (
    <button
      type="button"
      lang={next}
      aria-label={target}
      title={`${t("language")}: ${target}`}
      aria-busy={syncing}
      onClick={() => switchTo(next)}
      className={cn(
        variant === "landing"
          ? "locale-switch"
          : "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border px-2 transition-colors hover:bg-accent md:min-h-9 md:min-w-9",
        className,
      )}
    >
      <Flag className="h-3.5 w-5 shrink-0 rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.15)]" />
    </button>
  );
}
