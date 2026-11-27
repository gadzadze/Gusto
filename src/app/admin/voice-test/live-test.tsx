"use client";

import { Mic } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { VoiceAssistant, type VoiceAdapter } from "@/components/buyer/voice/voice-assistant";
import { Button } from "@/components/ui/button";
import type { VoiceRef } from "@/lib/voice/order-parse";
import { startLiveSessionAction } from "./actions";

/**
 * Live voice mode (experiment, admin only): the same full-screen assistant buyers get, but fed with the made-up catalogue pasted
 * above, and with a fill that stores nothing. This is the place to try the real interface without a buyer account or the buyer switch.
 */
export function LiveTest({ catalog, configured }: { catalog: string; configured: boolean }) {
  const t = useTranslations("admin.voiceTest");
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [finished, setFinished] = useState(false);

  const adapter = useMemo<VoiceAdapter>(
    () => ({
      start: async () => {
        const session = await startLiveSessionAction(catalog);
        if (!session.ok) return { ok: false, error: session.error === "invalid" || session.error === "bad_catalog" ? "invalid" : session.error };
        // Every made-up product is its own id; steps of half a unit are enough to try the steppers.
        const refs: Record<string, VoiceRef> = Object.fromEntries(session.items.map((i) => [i.id, { productId: i.id, minMilli: 500, stepMilli: 500 }]));
        return { ok: true, session, refs };
      },
      // Nothing is put in a cart or ordered: this is a try-out.
      fill: async () => ({ ok: true, skipped: [] }),
      finish: () => {
        setFinished(true);
        dialog.current?.close();
      },
    }),
    [catalog],
  );

  function show() {
    setFinished(false);
    setOpen(true);
    dialog.current?.showModal();
  }

  return (
    <section className="space-y-4" aria-labelledby="live-title">
      <div>
        <h2 id="live-title" className="text-base font-semibold">{t("live.title")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("live.intro")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={show} disabled={!configured}>
          <Mic aria-hidden /> {t("live.start")}
        </Button>
        {finished ? <p role="status" className="text-sm text-muted-foreground">{t("live.testNote")}</p> : null}
      </div>
      <p className="text-xs text-muted-foreground">{t("live.limit", { minutes: 10 })}</p>
      <dialog
        ref={dialog}
        data-motion="sheet"
        aria-label={t("live.title")}
        onClose={() => setOpen(false)}
        className="m-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-surface p-0 text-foreground backdrop:bg-black/40 sm:m-auto sm:h-[min(46rem,92dvh)] sm:max-w-md sm:rounded-3xl sm:border sm:border-border sm:shadow-xl"
      >
        {open ? <VoiceAssistant suppliers={[{ name: t("live.testSupplier"), count: catalog.split("\n").filter((l) => l.trim()).length }]} onClose={() => dialog.current?.close()} adapter={adapter} /> : null}
      </dialog>
    </section>
  );
}
