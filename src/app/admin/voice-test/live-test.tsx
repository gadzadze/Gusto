"use client";

import { useLocale, useTranslations } from "next-intl";
import { Mic, Square, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRODUCT_UNITS, type ProductUnit } from "@/lib/catalog/units";
import type { LiveOrderLine } from "@/lib/voice/live";
import { useLiveVoice } from "@/lib/voice/use-live-voice";
import { milliToInput } from "@/lib/quantity";
import { startLiveSessionAction } from "./actions";

// Live voice mode (experiment, admin only). Uses the shared browser half in `lib/voice/use-live-voice.ts`.

type ErrorKey = "micDenied" | "startFailed" | "connectionLost" | "rate_limited" | "not_configured" | "key_rejected" | "bad_catalog" | "upstream" | "invalid" | "unknown";

export function LiveTest({ catalog, configured }: { catalog: string; configured: boolean }) {
  const t = useTranslations("admin.voiceTest");
  const tu = useTranslations("unitNames");
  const locale = useLocale();
  const separator = locale === "en" ? "." : ",";
  const unitLabel = (code: string | null) => (code && (PRODUCT_UNITS as readonly string[]).includes(code) ? tu(code as ProductUnit) : (code ?? ""));

  const { phase, turns, order, deliveryDay, error: errorKey, start: startLive, stop } = useLiveVoice(async () => {
    const session = await startLiveSessionAction(catalog);
    if (!session.ok) return { ok: false, error: session.error === "invalid" || session.error === "bad_catalog" ? "bad_catalog" : (session.error as string) ?? "startFailed" };
    return { ok: true, session };
  });
  const error = errorKey as ErrorKey | null;
  const start = () => void startLive();

  // The order is kept separately for each supplier (one cart per supplier in the real app).
  const groups: { name: string | null; lines: LiveOrderLine[] }[] = [];
  for (const line of order) {
    const group = groups.find((g) => g.name === line.supplierName);
    if (group) group.lines.push(line);
    else groups.push({ name: line.supplierName, lines: [line] });
  }

  return (
    <section className="space-y-4 pt-4" aria-labelledby="live-title">
      <div>
        <h2 id="live-title" className="text-base font-semibold">{t("live.title")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("live.intro")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {phase === "idle" ? (
          <Button type="button" onClick={start} disabled={!configured}>
            <Mic aria-hidden /> {t("live.start")}
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={stop}>
            <Square aria-hidden /> {t("live.stop")}
          </Button>
        )}
        {phase === "connecting" ? <p role="status" className="text-sm text-muted-foreground">{t("live.connecting")}</p> : null}
        {phase === "live" ? <p role="status" className="text-sm text-brand">{t("live.listening")}</p> : null}
      </div>
      <p className="text-xs text-muted-foreground">{t("live.limit", { minutes: 10 })}</p>
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error === "micDenied" ? t("problems.mic_denied") : error === "startFailed" || error === "connectionLost" ? t(`live.${error}`) : t(`errors.${error}`)}
        </p>
      ) : null}

      {turns.length > 0 || order.length > 0 ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2">
          <div aria-live="polite">
            <h3 className="text-sm font-medium">{t("live.conversation")}</h3>
            <p className="text-xs text-muted-foreground">{t("live.transcriptNote")}</p>
            <ul className="mt-1 space-y-2">
              {turns.map((turn, i) => (
                <li key={i} className={turn.who === "you" ? "glass p-3 text-sm" : "rounded-lg bg-brand-soft p-3 text-sm"}>
                  <span className="block text-xs text-muted-foreground">{turn.who === "you" ? t("live.you") : t("live.assistant")}</span>
                  {turn.text}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-medium">{t("live.orderTitle")}</h3>
            {order.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">{t("live.orderEmpty")}</p>
            ) : (
              <div className="mt-1 space-y-4">
                {groups.map((group) => (
                  <div key={group.name ?? ""}>
                    {group.name ? <h4 className="mb-1 text-sm font-medium text-brand">{t("supplier", { name: group.name })}</h4> : null}
                    <ul className="glass">
                      {group.lines.map((line) => (
                        <li key={line.productId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3">
                          <p className="min-w-0 flex-[1_1_10rem] font-medium">{line.productName}</p>
                          <p className="tabular-nums">
                            {line.quantityMilli === null ? t("noQuantity") : milliToInput(line.quantityMilli, separator)} {unitLabel(line.unit)}
                          </p>
                          {line.unitCheck === "mismatch" ? (
                            <p role="alert" className="flex basis-full items-start gap-2 text-sm text-destructive">
                              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                              {t("unitMismatch", { said: line.spokenUnit ?? "", catalogue: unitLabel(line.catalogUnit) })}
                            </p>
                          ) : null}
                          {line.unitCheck === "converted" ? <p className="basis-full text-xs text-muted-foreground">{t("unitConverted", { from: line.spokenUnit ?? "", to: unitLabel(line.unit) })}</p> : null}
                          {line.unitCheck === "assumed" ? <p className="basis-full text-xs text-muted-foreground">{t("unitAssumed", { unit: unitLabel(line.unit) })}</p> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {deliveryDay ? <p className="mt-2 text-sm">{t("delivery", { day: deliveryDay })}</p> : null}
            <p className="mt-2 text-xs text-muted-foreground">{t("live.testNote")}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
