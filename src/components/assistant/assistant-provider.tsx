"use client";

import { ArrowUp, ChevronDown, Mic } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { applySupplierActionAction, runSupplierToolAction, startSupplierAssistantAction } from "@/app/supplier/assistant/actions";
import { VoiceAssistant, type AssistantCommand, type AssistantStatus, type VoiceAdapter, type VoiceSupplier } from "@/components/buyer/voice/voice-assistant";
import { cn } from "@/lib/utils";

// The assistant lives in the app shell, not on a page: one session and one thread for as long as the person stays in the area, whichever
// page they are on. The dock (a composer above the bottom bar) is always there; the panel opens over the page and can be minimised
// without ending anything. Nothing exists in the browser (no socket, no microphone) until the first command.

type Ctx = {
  role: "buyer" | "supplier";
  open: (command?: { text?: string; mic?: boolean }) => void;
  status: AssistantStatus;
};
const AssistantContext = createContext<Ctx | null>(null);

/** Null when the area has no assistant (voice off, business not approved): launchers then draw nothing. */
export function useAssistant() {
  return useContext(AssistantContext);
}

const supplierAdapter = (onClose: () => void): VoiceAdapter => ({
  start: async () => {
    const session = await startSupplierAssistantAction();
    return session.ok ? { ok: true, session, refs: {} } : { ok: false, error: session.error };
  },
  fill: async () => ({ ok: true, skipped: [] }),
  finish: onClose,
  lookup: (name, args) => runSupplierToolAction({ name, args }),
  apply: applySupplierActionAction,
});

export function AssistantProvider({ role, suppliers, children }: { role: "buyer" | "supplier"; suppliers: VoiceSupplier[]; children: React.ReactNode }) {
  const t = useTranslations("buyer.voice");
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState<AssistantCommand | null>(null);
  const [status, setStatus] = useState<AssistantStatus>({ phase: "idle", speaking: false });
  const counter = useRef(0);
  const panel = useRef<HTMLElement>(null);

  const openWith = useCallback((next?: { text?: string; mic?: boolean }) => {
    setMounted(true);
    setOpen(true);
    if (next) setCommand({ ...next, id: ++counter.current });
  }, []);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const adapter = role === "supplier" ? supplierAdapter(() => setOpen(false)) : undefined;

  return (
    <AssistantContext.Provider value={{ role, open: openWith, status }}>
      {children}
      {mounted ? (
        <section
          ref={panel}
          tabIndex={-1}
          role="dialog"
          aria-label={t("title")}
          hidden={!open}
          className="fixed inset-0 z-50 overflow-hidden bg-surface text-foreground outline-none sm:inset-y-4 sm:left-auto sm:right-4 sm:w-[26rem] sm:rounded-3xl sm:shadow-2xl print:hidden"
        >
          <VoiceAssistant suppliers={suppliers} role={role} adapter={adapter} command={command} onStatus={setStatus} onClose={() => setOpen(false)} />
        </section>
      ) : null}
      {!open ? <Dock role={role} status={status} onOpen={openWith} /> : null}
    </AssistantContext.Provider>
  );
}

/** The composer that follows the person from page to page: type a command, or tap the microphone. While a session is live it shows its state. */
function Dock({ role, status, onOpen }: { role: "buyer" | "supplier"; status: AssistantStatus; onOpen: (command?: { text?: string; mic?: boolean }) => void }) {
  const t = useTranslations("buyer.voice");
  const [draft, setDraft] = useState("");
  const live = status.phase !== "idle";
  const label = status.phase === "connecting" ? t("dockWorking") : status.speaking ? t("dockAnswering") : t("dockLive");
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 px-3 md:bottom-4 md:left-[15rem] print:hidden">
      <div className="pointer-events-auto mx-auto flex max-w-xl items-center gap-2 rounded-full glass glass-strong p-1.5">
        {live ? (
          <button type="button" onClick={() => onOpen({})} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full px-3 text-left">
            <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full bg-brand", !status.speaking && "animate-pulse motion-reduce:animate-none")} />
            <span role="status" className="truncate text-sm font-medium">{label}</span>
            <span className="sr-only">{t("dockOpen")}</span>
          </button>
        ) : (
          <form
            className="flex min-w-0 flex-1 items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const text = draft.trim();
              if (!text) return;
              setDraft("");
              onOpen({ text });
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={300}
              enterKeyHint="send"
              autoComplete="off"
              aria-label={role === "supplier" ? t("dockPlaceholderSupplier") : t("dockPlaceholder")}
              placeholder={role === "supplier" ? t("dockPlaceholderSupplier") : t("dockPlaceholder")}
              className="min-h-11 min-w-0 flex-1 bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground"
            />
            {draft.trim() ? (
              <button type="submit" aria-label={t("textSend")} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-tonal">
                <ArrowUp aria-hidden />
              </button>
            ) : null}
          </form>
        )}
        <button
          type="button"
          onClick={() => onOpen(live ? {} : { mic: true })}
          aria-label={live ? t("dockOpen") : t("open")}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {live ? <ChevronDown aria-hidden className="rotate-180" /> : <Mic aria-hidden />}
        </button>
      </div>
    </div>
  );
}

