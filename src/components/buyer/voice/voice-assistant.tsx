"use client";

import { Check, ChevronDown, Keyboard, LoaderCircle, Mic, MicOff, Minus, Plus, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { fillCartsFromVoiceAction, startBuyerVoiceAction } from "@/app/buyer/voice/actions";
import { Button, ForwardArrow } from "@/components/ui/button";
import { PRODUCT_UNITS, type ProductUnit } from "@/lib/catalog/units";
import { isOrderableQuantity, milliToInput, stepDown, stepUp } from "@/lib/quantity";
import { cn } from "@/lib/utils";
import { type LiveOrderLine } from "@/lib/voice/live";
import { useLiveVoice } from "@/lib/voice/use-live-voice";
import type { VoiceRef } from "@/lib/voice/order-parse";

type Separator = "." | ",";

export type VoiceSupplier = { name: string; count: number };

type View = "talk" | "review";
export type VoiceLine = LiveOrderLine & { qty: number | null; unitOk: boolean };

const KNOWN_ERRORS = ["startFailed", "connectionLost", "rate_limited", "not_configured", "no_products", "pending", "invalid"];

/**
 * The full-screen voice assistant. Two views in one dialog: talking (a caption, what was captured, the microphone) and the review
 * of the proposed order. The assistant only proposes; the lines go into the carts and the buyer sends each one through the normal
 * checkout. Layout rule: one column, one rhythm (8px steps), one accent colour, and the same dock in every state.
 */
export function VoiceAssistant({ suppliers, onClose }: { suppliers: VoiceSupplier[]; onClose: () => void }) {
  const tu = useTranslations("unitNames");
  const locale = useLocale();
  const router = useRouter();
  const separator: Separator = locale === "en" ? "." : ",";
  const unitLabel = (code: string | null) => (code && (PRODUCT_UNITS as readonly string[]).includes(code) ? tu(code as ProductUnit) : (code ?? ""));

  const [refs, setRefs] = useState<Record<string, VoiceRef>>({});
  const voice = useLiveVoice(async () => {
    const session = await startBuyerVoiceAction();
    if (!session.ok) return { ok: false, error: session.error };
    setRefs(session.refs);
    return { ok: true, session };
  });

  const [view, setView] = useState<View>("talk");
  const [lines, setLines] = useState<VoiceLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [fillError, setFillError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[] | null>(null);

  const live = voice.phase === "live";
  const connecting = voice.phase === "connecting";
  const blocked = voice.error === "micDenied";
  const errorKey = voice.error && !blocked ? (KNOWN_ERRORS.includes(voice.error) ? voice.error : "unknown") : null;

  function finish() {
    const captured = voice.order;
    voice.stop();
    if (captured.length === 0) return;
    setLines(captured.map((l) => ({ ...l, qty: l.quantityMilli, unitOk: l.unitCheck !== "mismatch" })));
    setSkipped(null);
    setFillError(null);
    setView("review");
  }

  async function confirm() {
    setBusy(true);
    setFillError(null);
    const result = await fillCartsFromVoiceAction({
      lines: lines.filter((l) => l.qty !== null).map((l) => ({ productId: refs[l.productId].productId, qtyMilli: l.qty as number })),
    });
    setBusy(false);
    if (!result.ok) return setFillError(KNOWN_ERRORS.includes(result.error) ? result.error : "unknown");
    if (result.skipped.length === 0) {
      router.push("/buyer/cart");
      onClose();
    } else setSkipped(result.skipped);
  }

  if (view === "review") {
    return (
      <VoiceReview
        lines={lines}
        setLines={setLines}
        refs={refs}
        busy={busy}
        skipped={skipped}
        errorKey={fillError}
        onConfirm={() => void confirm()}
        onToCart={() => {
          router.push("/buyer/cart");
          onClose();
        }}
        onClose={onClose}
        unitLabel={unitLabel}
        separator={separator}
      />
    );
  }

  return (
    <TalkView
      suppliers={suppliers}
      connecting={connecting}
      live={live}
      speaking={voice.speaking}
      turns={voice.turns}
      order={voice.order}
      levels={voice.levels}
      blocked={blocked}
      errorKey={errorKey}
      onStart={() => void voice.start()}
      onRetry={() => {
        voice.clearError();
        void voice.start();
      }}
      onFinish={finish}
      onClose={onClose}
      unitLabel={unitLabel}
      separator={separator}
    />
  );
}

type TalkProps = {
  suppliers: VoiceSupplier[];
  connecting: boolean;
  live: boolean;
  speaking: boolean;
  turns: { who: "you" | "assistant"; text: string }[];
  order: LiveOrderLine[];
  levels: number[];
  blocked: boolean;
  errorKey: string | null;
  onStart: () => void;
  onRetry: () => void;
  onFinish: () => void;
  onClose: () => void;
  unitLabel: (code: string | null) => string;
  separator: Separator;
};

/** The talking view, as plain props so a fixture can render it without a microphone or a socket. */
export function TalkView({ suppliers, connecting, live, speaking, turns, order, levels, blocked, errorKey, onStart, onRetry, onFinish, onClose, unitLabel, separator }: TalkProps) {
  const t = useTranslations("buyer.voice");
  const status = connecting ? t("connecting") : live ? (speaking ? t("answering") : t("listening")) : null;
  const shown = turns.slice(-2);
  const lastIndex = shown.length - 1;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 px-6 pt-6">
        <IconButton label={t("close")} onClick={onClose}>
          <X aria-hidden />
        </IconButton>
        {status ? (
          <p role="status" className="inline-flex min-h-8 items-center gap-2 rounded-full bg-brand-soft px-3 text-sm font-medium text-brand">
            <span aria-hidden className={cn("size-2 rounded-full bg-brand", live && "animate-pulse motion-reduce:animate-none")} />
            {status}
          </p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-6">
        {blocked ? (
          <Blocked onRetry={onRetry} onClose={onClose} />
        ) : !live && !connecting && turns.length === 0 ? (
          <Intro suppliers={suppliers} />
        ) : (
          <div className="space-y-8">
            <div aria-live="polite" className="space-y-3">
              {shown.length === 0 ? <p className="text-xl text-muted-foreground">{t("listening")}</p> : null}
              {shown.map((turn, i) => (
                <p
                  key={turns.length - shown.length + i}
                  className={cn(
                    "text-balance text-xl leading-snug",
                    i === lastIndex ? "font-semibold text-foreground" : "font-normal text-muted-foreground",
                    turn.who === "assistant" && i === lastIndex && "text-brand",
                  )}
                >
                  {turn.text}
                </p>
              ))}
            </div>
            <Ledger lines={order} unitLabel={unitLabel} separator={separator} />
          </div>
        )}
        {errorKey ? (
          <p role="alert" className="mt-6 flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t(`errors.${errorKey}`)}
          </p>
        ) : null}
      </div>

      {!blocked ? (
        <footer className="px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
          <Wave levels={levels} active={live} />
          <div className="mt-4 grid grid-cols-3 items-start">
            <DockSlot label={t("text")}>
              <Link href="/buyer/search" onClick={onClose} aria-label={t("text")} className={ringButton}>
                <Keyboard aria-hidden />
              </Link>
            </DockSlot>
            <DockSlot label={connecting ? t("connecting") : live ? t("listening") : t("speak")} strong>
              <button
                type="button"
                onClick={onStart}
                disabled={live}
                aria-label={t("speak")}
                aria-pressed={live}
                className={cn(
                  "inline-flex size-[4.75rem] items-center justify-center rounded-full bg-brand text-brand-foreground transition-transform duration-150 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 disabled:cursor-default [&_svg]:size-7",
                  live && "ring-2 ring-brand ring-offset-4 ring-offset-surface",
                )}
              >
                {connecting ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Mic aria-hidden />}
              </button>
            </DockSlot>
            <DockSlot label={live || order.length > 0 ? t("finish") : ""}>
              {live || order.length > 0 ? (
                <button type="button" onClick={onFinish} aria-label={t("finish")} className={ringButton}>
                  <Check aria-hidden />
                </button>
              ) : (
                <span aria-hidden className="size-14" />
              )}
            </DockSlot>
          </div>
        </footer>
      ) : null}
    </div>
  );
}

const ringButton =
  "inline-flex size-14 items-center justify-center rounded-full border border-input bg-surface text-foreground transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand active:scale-95 motion-reduce:active:scale-100 [&_svg]:size-5";

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={cn(ringButton, "size-11")}>
      {children}
    </button>
  );
}

/** A control and its label, on one shared baseline: the label row has a fixed height, so the three never drift apart. */
function DockSlot({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex h-[4.75rem] items-center justify-center">{children}</div>
      <p className={cn("mt-2 h-5 text-sm", strong ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</p>
    </div>
  );
}

/** The level strip: a tape of the last few seconds. Quiet is a row of dots, so the screen is never empty. */
function Wave({ levels, active }: { levels: number[]; active: boolean }) {
  return (
    <div aria-hidden className="flex h-10 items-center justify-between">
      {levels.map((level, i) => (
        <span
          key={i}
          className={cn("w-[3px] rounded-full bg-brand", active ? "opacity-100" : "opacity-40")}
          style={{ height: `${Math.max(3, Math.round(level * 40))}px` }}
        />
      ))}
    </div>
  );
}

function Intro({ suppliers }: { suppliers: VoiceSupplier[] }) {
  const t = useTranslations("buyer.voice");
  const examples = t.raw("examples") as string[];
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-balance text-[1.75rem] font-semibold leading-tight">{t("title")}</h2>
        <p className="text-base text-muted-foreground">{t("lead")}</p>
      </div>
      <section aria-labelledby="voice-suppliers" className="glass px-4 py-1">
        <h3 id="voice-suppliers" className="sr-only">{t("suppliersTitle")}</h3>
        <ul>
          {suppliers.map((s) => (
            <li key={s.name} className="flex items-baseline justify-between gap-4 py-3">
              <span className="min-w-0 font-semibold">{s.name}</span>
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{t("productCount", { count: s.count })}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="voice-examples" className="glass px-4 py-1">
        <h3 id="voice-examples" className="sr-only">{t("examplesTitle")}</h3>
        <ul>
          {examples.map((e) => (
            <li key={e} className="py-2.5 text-muted-foreground">{e}</li>
          ))}
        </ul>
      </section>
      <p className="text-sm text-muted-foreground">{t("privacy")}</p>
    </div>
  );
}

function Blocked({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
  const t = useTranslations("buyer.voice");
  return (
    <div className="space-y-8">
      <MicOff aria-hidden className="size-8 text-destructive" />
      <div className="space-y-3">
        <h2 className="text-balance text-[2rem] font-semibold leading-tight">{t("blocked.title")}</h2>
        <p className="text-base text-muted-foreground">{t("blocked.body")}</p>
      </div>
      <ol className="list-decimal space-y-3 pl-6 marker:text-muted-foreground">
        <li>{t("blocked.step1")}</li>
        <li>{t("blocked.step2")}</li>
        <li>{t("blocked.step3")}</li>
      </ol>
      <div className="space-y-2">
        <Button type="button" size="lg" className="w-full" onClick={onRetry}>
          {t("blocked.retry")}
        </Button>
        <Button asChild variant="outline" size="lg" className="w-full">
          <Link href="/buyer/search" onClick={onClose}>{t("blocked.typeInstead")}</Link>
        </Button>
      </div>
    </div>
  );
}

function groupBySupplier<T extends { supplierName: string | null }>(items: T[]): { name: string | null; items: T[] }[] {
  const groups: { name: string | null; items: T[] }[] = [];
  for (const item of items) {
    const group = groups.find((g) => g.name === item.supplierName);
    if (group) group.items.push(item);
    else groups.push({ name: item.supplierName, items: [item] });
  }
  return groups;
}

/** What has been captured so far; folded away by default so the caption keeps the screen. */
function Ledger({ lines, unitLabel, separator }: { lines: LiveOrderLine[]; unitLabel: (code: string | null) => string; separator: Separator }) {
  const t = useTranslations("buyer.voice");
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => groupBySupplier(lines), [lines]);
  if (lines.length === 0) return null;
  return (
    <section className="glass px-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-3 text-sm font-semibold"
      >
        {t("captured", { count: lines.length })}
        <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-4 pb-2 pt-1">
          {groups.map((g) => (
            <div key={g.name ?? ""}>
              {g.name ? <p className="text-sm text-muted-foreground">{g.name}</p> : null}
              <ul>
                {g.items.map((l) => (
                  <li key={l.productId} className="flex items-baseline justify-between gap-4 py-2">
                    <span className="min-w-0">{l.productName}</span>
                    <span className="shrink-0 tabular-nums">
                      {l.quantityMilli === null ? "?" : milliToInput(l.quantityMilli, separator)} {unitLabel(l.unitCheck === "mismatch" ? l.spokenUnit : l.unit)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

type Issue = { text: string; fixLabel: string; fix: Partial<Pick<VoiceLine, "qty" | "unitOk">> };

/** The review: one pane per supplier, the unit beside the quantity, a problem shown under its own row, and a summary and button that say what is left. */
export function VoiceReview({
  lines,
  setLines,
  refs,
  busy,
  skipped,
  errorKey,
  onConfirm,
  onToCart,
  onClose,
  unitLabel,
  separator,
}: {
  lines: VoiceLine[];
  setLines: React.Dispatch<React.SetStateAction<VoiceLine[]>>;
  refs: Record<string, VoiceRef>;
  busy: boolean;
  skipped: string[] | null;
  errorKey: string | null;
  onConfirm: () => void;
  onToCart: () => void;
  onClose: () => void;
  unitLabel: (code: string | null) => string;
  separator: Separator;
}) {
  const t = useTranslations("buyer.voice");
  const groups = groupBySupplier(lines);

  const issueOf = (line: VoiceLine): Issue | null => {
    const ref = refs[line.productId];
    if (!ref) return null;
    const fix = (quantity: number) => t("review.fixUnit", { quantity: milliToInput(quantity, separator), unit: unitLabel(line.catalogUnit) });
    if (!line.unitOk) {
      return line.qty === null ? null : { text: t("review.unitMismatch"), fixLabel: fix(line.qty), fix: { unitOk: true } };
    }
    if (line.qty === null) return { text: t("review.needsQuantity"), fixLabel: fix(ref.minMilli), fix: { qty: ref.minMilli } };
    if (!isOrderableQuantity(line.qty, ref.minMilli, ref.stepMilli)) {
      const steps = Math.max(0, Math.round((line.qty - ref.minMilli) / ref.stepMilli));
      const nearest = ref.minMilli + steps * ref.stepMilli;
      return { text: t("review.badQuantity"), fixLabel: fix(nearest), fix: { qty: nearest } };
    }
    return null;
  };
  const patch = (id: string, change: Partial<VoiceLine> | null) =>
    setLines((all) => (change === null ? all.filter((l) => l.productId !== id) : all.map((l) => (l.productId === id ? { ...l, ...change } : l))));
  const open = lines.filter((l) => issueOf(l) !== null).length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold leading-tight">{t("review.title")}</h2>
          {lines.length > 0 ? <p className="mt-1 text-sm text-muted-foreground">{t("review.meta", { suppliers: groups.length, count: lines.length })}</p> : null}
          {lines.length > 0 ? (
            open > 0 ? (
              <p role="status" className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-600/35 bg-amber-500/10 px-3 py-1 text-sm font-semibold text-amber-800 dark:border-amber-400/35 dark:text-amber-300">
                <TriangleAlert aria-hidden className="size-3.5" />
                {t("review.needFix", { count: open })}
              </p>
            ) : (
              <p role="status" className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-green-600/30 bg-green-500/10 px-3 py-1 text-sm font-semibold text-green-800 dark:border-green-400/30 dark:text-green-300">
                <Check aria-hidden className="size-3.5" />
                {t("review.ready")}
              </p>
            )
          ) : null}
        </div>
        <IconButton label={t("close")} onClick={onClose}>
          <X aria-hidden />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pb-4 pt-4">
        {lines.length === 0 ? <p className="text-muted-foreground">{t("review.empty")}</p> : null}
        {groups.map((g) => (
          <section key={g.name ?? ""} aria-label={g.name ?? undefined} className="glass overflow-hidden">
            <div className="flex items-baseline justify-between gap-4 px-4 py-3">
              <h3 className="min-w-0 font-semibold">{g.name}</h3>
              <p className="shrink-0 text-sm tabular-nums text-muted-foreground">{t("review.linesOf", { count: g.items.length })}</p>
            </div>
            <ul>
              {g.items.map((line) => {
                const ref = refs[line.productId];
                const issue = issueOf(line);
                // While the unit is not settled the quantity is shown in the unit that was said.
                const shownUnit = line.unitOk ? line.catalogUnit : (line.spokenUnit ?? line.catalogUnit);
                return (
                  <li key={line.productId} className={cn(issue && "bg-destructive/5 shadow-[inset_3px_0_0_var(--destructive)]")}>
                    <div className="flex items-center gap-3 px-4 py-2.5">
                      <p className="min-w-0 flex-1 font-semibold leading-snug">{line.productName}</p>
                      <div className="flex shrink-0 items-center">
                        <Stepper
                          label={t("review.decrease", { name: line.productName })}
                          onClick={() => {
                            const next = line.qty === null || !ref ? 0 : stepDown(line.qty, ref.minMilli, ref.stepMilli);
                            patch(line.productId, next === 0 ? null : { qty: next });
                          }}
                        >
                          <Minus aria-hidden />
                        </Stepper>
                        <span className="w-16 text-center font-semibold tabular-nums">
                          {line.qty === null ? "?" : milliToInput(line.qty, separator)}
                          <small className="ml-0.5 text-sm font-normal text-muted-foreground">{unitLabel(shownUnit)}</small>
                        </span>
                        <Stepper
                          label={t("review.increase", { name: line.productName })}
                          onClick={() => ref && patch(line.productId, { qty: stepUp(line.qty ?? 0, ref.minMilli, ref.stepMilli), unitOk: true })}
                        >
                          <Plus aria-hidden />
                        </Stepper>
                      </div>
                    </div>
                    {issue ? (
                      <div role="alert" className="flex items-center justify-between gap-3 px-4 pb-2.5 text-sm text-destructive">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                          {issue.text}
                        </span>
                        <button
                          type="button"
                          onClick={() => patch(line.productId, issue.fix)}
                          className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border border-input bg-[var(--glass-strong)] px-3 font-semibold text-foreground hover:bg-muted"
                        >
                          {issue.fixLabel}
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <footer className="space-y-2 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
        {errorKey ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t(`errors.${errorKey}`)}
          </p>
        ) : null}
        {skipped ? (
          <div className="space-y-3">
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t("review.skipped", { names: skipped.join(", ") })}
            </p>
            <Button type="button" size="lg" className="w-full" onClick={onToCart}>
              {t("review.toCart")}
            </Button>
          </div>
        ) : (
          <>
            <Button type="button" size="lg" className="w-full" loading={busy} onClick={onConfirm} disabled={lines.length === 0 || open > 0}>
              {t("review.confirm")}
              {open === 0 && lines.length > 0 ? <span className="font-normal opacity-70">· {lines.length}</span> : null}
              <ForwardArrow />
            </Button>
            <p className="text-center text-sm text-muted-foreground">{open > 0 ? t("review.fixFirst") : t("review.confirmNote")}</p>
          </>
        )}
      </footer>
    </div>
  );
}

function Stepper({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  // The tap area is 44px; the visible circle is 34px so a row stays slim.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="group inline-flex size-11 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand [&_svg]:size-4"
    >
      <span className="grid size-[34px] place-items-center rounded-full border border-input bg-[var(--glass-strong)] transition-transform group-hover:bg-muted group-active:scale-95 motion-reduce:group-active:scale-100">
        {children}
      </span>
    </button>
  );
}
