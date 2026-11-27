"use client";

import { Mic } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { VoiceAssistant, type VoiceLaunch, type VoiceSupplier } from "@/components/buyer/voice/voice-assistant";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Where voice ordering starts: a mic at the end of the search field, or a card on the buyer's home. Both open the same full-screen
 * assistant. The assistant is only mounted while the dialog is open, so nothing (no microphone, no socket) exists before that.
 */
export type VoiceChip = { label: string; command: string };

export function VoiceLauncher({ variant, suppliers, chips = [] }: { variant: "field" | "card" | "bar"; suppliers: VoiceSupplier[]; chips?: VoiceChip[] }) {
  const t = useTranslations("buyer.voice");
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [launch, setLaunch] = useState<VoiceLaunch | undefined>(undefined);
  const [draft, setDraft] = useState("");

  function show(next?: VoiceLaunch) {
    setLaunch(next);
    setOpen(true);
    dialog.current?.showModal();
  }

  return (
    <>
      {variant === "bar" ? (
        <div className="space-y-3">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              const text = draft.trim();
              if (!text) return;
              setDraft("");
              show({ text });
            }}
          >
            <label htmlFor="command-bar" className="sr-only">{t("barLabel")}</label>
            <Input
              id="command-bar"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={300}
              enterKeyHint="send"
              autoComplete="off"
              placeholder={t("barPlaceholder")}
              className="h-14 rounded-full bg-[var(--glass)] pl-5 pr-16 text-base backdrop-blur-[18px]"
            />
            <button
              type="button"
              onClick={() => show({ mic: true })}
              aria-label={t("open")}
              className="absolute right-1.5 top-1.5 inline-flex size-11 items-center justify-center rounded-full bg-brand text-brand-foreground transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand [&_svg]:size-5"
            >
              <Mic aria-hidden />
            </button>
          </form>
          {chips.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <button
                  key={chip.command}
                  type="button"
                  onClick={() => show({ text: chip.command })}
                  className="rounded-btn inline-flex min-h-11 items-center bg-tonal px-3.5 text-sm font-medium transition-colors hover:bg-tonal-hover active:scale-[0.98]"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : variant === "field" ? (
        <button
          type="button"
          onClick={() => show()}
          aria-label={t("open")}
          className="absolute right-0.5 top-0.5 inline-flex size-11 items-center justify-center rounded-full text-brand transition-colors hover:bg-brand-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand [&_svg]:size-5"
        >
          <Mic aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => show()}
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
        {open ? <VoiceAssistant suppliers={suppliers} onClose={() => dialog.current?.close()} launch={launch} /> : null}
      </dialog>
    </>
  );
}
