"use client";

import { Check, Globe, Search, Upload } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  applyPhotoCandidateAction,
  applyWebImageAction,
  searchPhotoCandidatesAction,
  searchWebImagesAction,
  type PhotoCandidate,
} from "@/app/supplier/products/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";

type Product = { id: string; name: string; brand: string | null };
type WebCandidate = { token: string; thumbnail: string; title: string; site: string };
type WebState =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "results"; candidates: WebCandidate[] }
  | { kind: "unavailable" }
  | { kind: "limited" }
  | { kind: "done" };

type State =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "results"; candidates: PhotoCandidate[] }
  | { kind: "unavailable" }
  | { kind: "limited" }
  | { kind: "done" }
  | { kind: "skipped" };

// Open Food Facts asks for gentle use: one search every few seconds.
const SEARCH_GAP_MS = 3500;

export function PhotoSuggestions({ products, disabled, webEnabled }: { products: Product[]; disabled?: boolean; webEnabled?: boolean }) {
  const t = useTranslations("photoSuggest");
  const [states, setStates] = useState<Record<string, State>>({});
  const [webStates, setWebStates] = useState<Record<string, WebState>>({});
  const [running, setRunning] = useState(false);
  const set = (id: string, state: State) => setStates((prev) => ({ ...prev, [id]: state }));

  const searchOne = async (id: string): Promise<boolean> => {
    set(id, { kind: "searching" });
    const response = await searchPhotoCandidatesAction(id);
    if (!response.ok) {
      set(id, { kind: response.error === "rate_limited" ? "limited" : "unavailable" });
      return response.error !== "rate_limited";
    }
    const { candidates, unavailable } = response.outcome;
    set(id, unavailable ? { kind: "unavailable" } : { kind: "results", candidates });
    return true;
  };

  const searchAll = async () => {
    setRunning(true);
    for (const p of products) {
      const current = states[p.id]?.kind;
      if (current === "done" || current === "results" || current === "skipped") continue;
      const goOn = await searchOne(p.id);
      if (!goOn) break;
      await new Promise((r) => setTimeout(r, SEARCH_GAP_MS));
    }
    setRunning(false);
  };

  const setWeb = (id: string, state: WebState) => setWebStates((prev) => ({ ...prev, [id]: state }));

  const searchWeb = async (id: string) => {
    setWeb(id, { kind: "searching" });
    const response = await searchWebImagesAction(id);
    if (!response.ok) return setWeb(id, { kind: response.error === "rate_limited" ? "limited" : "unavailable" });
    setWeb(id, response.outcome.unavailable ? { kind: "unavailable" } : { kind: "results", candidates: response.outcome.candidates });
  };

  const pickWeb = async (id: string, token: string) => {
    setWeb(id, { kind: "searching" });
    const response = await applyWebImageAction(id, token);
    if (response.ok && response.status === "attached") {
      setWeb(id, { kind: "done" });
      set(id, { kind: "done" });
    } else setWeb(id, { kind: "unavailable" });
  };

  const pick = async (productId: string, barcode: string) => {
    set(productId, { kind: "searching" });
    const response = await applyPhotoCandidateAction(productId, barcode);
    set(productId, response.ok && response.status === "attached" ? { kind: "done" } : { kind: "unavailable" });
  };

  return (
    <div className="space-y-4">
      <Button disabled={disabled || running} onClick={searchAll}>
        <Search />
        {running ? t("searching") : t("searchAll")}
      </Button>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {products.map((p) => {
          const state = states[p.id] ?? { kind: "idle" };
          return (
            <li key={p.id} className="space-y-3 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 font-medium">{p.name}</p>
                <div className="flex items-center gap-2">
                  {state.kind === "idle" || state.kind === "unavailable" || state.kind === "limited" ? (
                    <Button size="sm" variant="outline" disabled={disabled || running} onClick={() => searchOne(p.id)}>
                      {t("search")}
                    </Button>
                  ) : null}
                  {webEnabled ? (
                    <Button size="sm" variant="outline" disabled={disabled || running} onClick={() => searchWeb(p.id)}>
                      <Globe />
                      {t("searchWeb")}
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/supplier/products/${p.id}`}>
                      <Upload />
                      {t("uploadOwn")}
                    </Link>
                  </Button>
                </div>
              </div>
              {state.kind === "searching" ? <p className="text-sm text-muted-foreground">{t("searchingOne")}</p> : null}
              {state.kind === "done" ? (
                <p className="flex items-center gap-1.5 text-sm text-[var(--status-green-fg)]">
                  <Check aria-hidden className="size-4" />
                  {t("applied")}
                </p>
              ) : null}
              {state.kind === "unavailable" ? <FormAlert tone="warning">{t("unavailable")}</FormAlert> : null}
              {state.kind === "limited" ? <FormAlert tone="warning">{t("limited")}</FormAlert> : null}
              {state.kind === "skipped" ? <p className="text-sm text-muted-foreground">{t("skipped")}</p> : null}
              {(() => {
                const web = webStates[p.id] ?? { kind: "idle" };
                if (web.kind === "searching") return <p className="text-sm text-muted-foreground">{t("searchingWeb")}</p>;
                if (web.kind === "unavailable") return <FormAlert tone="warning">{t("webUnavailable")}</FormAlert>;
                if (web.kind === "limited") return <FormAlert tone="warning">{t("limited")}</FormAlert>;
                if (web.kind !== "results") return null;
                if (web.candidates.length === 0) return <p className="text-sm text-muted-foreground">{t("webNone")}</p>;
                return (
                  <div className="space-y-2">
                    <FormAlert tone="warning">{t("webWarning")}</FormAlert>
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {web.candidates.map((c) => (
                        <li key={c.token} className="space-y-1.5 rounded-lg border border-border p-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={c.thumbnail} alt={c.title} className="aspect-square w-full rounded-md bg-white object-contain" />
                          <p className="line-clamp-2 text-xs">{c.title || "-"}</p>
                          <p className="line-clamp-1 text-xs text-muted-foreground">{c.site}</p>
                          <Button size="sm" className="w-full" disabled={disabled} onClick={() => pickWeb(p.id, c.token)}>
                            {t("use")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
              {state.kind === "results" ? (
                state.candidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("none")}</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">{t("pickOne")}</p>
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {state.candidates.map((c) => (
                        <li key={c.barcode} className="space-y-1.5 rounded-lg border border-border p-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={c.thumbnail} alt={c.name} loading="lazy" className="aspect-square w-full rounded-md bg-white object-contain" />
                          <p className="line-clamp-2 text-xs">{c.name || "-"}</p>
                          <p className="line-clamp-1 text-xs text-muted-foreground">{[c.brands, c.quantity].filter(Boolean).join(" · ")}</p>
                          <Button size="sm" className="w-full" disabled={disabled} onClick={() => pick(p.id, c.barcode)}>
                            {t("use")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <Button size="sm" variant="ghost" onClick={() => set(p.id, { kind: "skipped" })}>
                      {t("noneOfThese")}
                    </Button>
                  </div>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t("credit")}</p>
    </div>
  );
}
