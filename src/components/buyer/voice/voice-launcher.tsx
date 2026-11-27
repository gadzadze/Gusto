"use client";

import { Mic } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { VoiceAssistant, type VoiceSupplier } from "@/components/buyer/voice/voice-assistant";
import { cn } from "@/lib/utils";

/**
 * Where voice ordering starts: a mic at the end of the search field, or a card on the buyer's home. Both open the same full-screen
 * assistant. The assistant is only mounted while the dialog is open, so nothing (no microphone, no socket) exists before that.
 */
export function VoiceLauncher({ variant, suppliers }: { variant: "field" | "card"; suppliers: VoiceSupplier[] }) {
  const t = useTranslations("buyer.voice");
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  function show() {
    setOpen(true);
    dialog.current?.showModal();
  }

  return (
    <>
      {variant === "field" ? (
        <button
          type="button"
          onClick={show}
          aria-label={t("open")}
          className="absolute right-0 top-0 inline-flex size-11 items-center justify-center rounded-md text-brand transition-colors hover:bg-brand-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand [&_svg]:size-5"
        >
          <Mic aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={show}
          className={cn(
            "flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand",
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t("card.title")}</span>
            <span className="mt-1 block text-sm text-muted-foreground">{t("card.body")}</span>
          </span>
          <span aria-hidden className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground">
            <Mic className="size-5" />
          </span>
          <span className="sr-only">{t("card.action")}</span>
        </button>
      )}
      <dialog
        ref={dialog}
        data-motion="sheet"
        aria-label={t("title")}
        onClose={() => setOpen(false)}
        className="m-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-surface p-0 text-foreground backdrop:bg-black/40 sm:m-auto sm:h-[min(46rem,92dvh)] sm:max-w-md sm:rounded-3xl sm:border sm:border-border sm:shadow-xl"
      >
        {open ? <VoiceAssistant suppliers={suppliers} onClose={() => dialog.current?.close()} /> : null}
      </dialog>
    </>
  );
}
