"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

// Light / dark / follow the device. The choice lives in this browser only (localStorage); the
// script in layout.tsx applies it before first paint. "system" means no saved choice.

type Pref = "system" | "light" | "dark";
const KEY = "gusto-theme";
const QUERY = "(prefers-color-scheme: dark)";

function read(): Pref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(pref: Pref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia(QUERY).matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  const media = window.matchMedia(QUERY);
  const onDevice = () => {
    if (read() === "system") apply("system");
  };
  media.addEventListener("change", onDevice);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    media.removeEventListener("change", onDevice);
    window.removeEventListener("storage", callback);
  };
}

function choose(pref: Pref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Private mode and the like: the choice still applies until the page is left.
  }
  apply(pref);
  listeners.forEach((l) => l());
}

const OPTIONS: { pref: Pref; Icon: typeof Sun }[] = [
  { pref: "light", Icon: Sun },
  { pref: "dark", Icon: Moon },
  { pref: "system", Icon: Monitor },
];

const NEXT: Record<Pref, Pref> = { system: "light", light: "dark", dark: "system" };

/** `compact`: one 44px button that cycles light, dark, device (for the phone header). */
export function ThemeToggle({ className, compact }: { className?: string; compact?: boolean }) {
  const t = useTranslations("theme");
  const pref = useSyncExternalStore(subscribe, read, () => "system" as Pref);
  if (compact) {
    const Icon = OPTIONS.find((o) => o.pref === pref)!.Icon;
    return (
      <button
        type="button"
        aria-label={`${t("label")}: ${t(pref)}`}
        title={t(pref)}
        onClick={() => choose(NEXT[pref])}
        className={cn("inline-flex size-11 items-center justify-center text-muted-foreground", className)}
      >
        <Icon aria-hidden className="size-5" />
      </button>
    );
  }
  return (
    <div role="group" aria-label={t("label")} className={cn("inline-flex rounded-lg border border-border p-0.5", className)}>
      {OPTIONS.map(({ pref: option, Icon }) => (
        <button
          key={option}
          type="button"
          aria-pressed={pref === option}
          aria-label={t(option)}
          title={t(option)}
          onClick={() => choose(option)}
          className={cn(
            "inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground md:size-8",
            pref === option && "bg-accent text-accent-foreground",
          )}
        >
          <Icon aria-hidden className="size-4" />
        </button>
      ))}
    </div>
  );
}
