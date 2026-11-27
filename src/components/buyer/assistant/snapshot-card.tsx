"use client";

import { Check, ChevronRight, LoaderCircle } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ProductCard } from "@/components/buyer/product-card";
import { Button } from "@/components/ui/button";
import type { ApplyResult, OrderSnap, ProposalAction, ProposalView, Snapshot } from "@/lib/assistant/snapshots";
import { cn } from "@/lib/utils";

const DOT: Record<OrderSnap["status"], string> = {
  pending: "bg-amber-500",
  confirmed: "bg-blue-500",
  delivered: "bg-green-600",
  rejected: "bg-muted-foreground",
  cancelled: "bg-muted-foreground",
};

/**
 * What the assistant shows in the thread when the buyer asks to see something. The same facts the page has, drawn compactly, each with a
 * way to open the full page: the manual side is always there. The data arrives already formatted from the server.
 */
export function SnapshotCard({ view, onChoose, onApply }: { view: Snapshot; onChoose?: (label: string) => void; onApply?: (action: ProposalAction) => Promise<ApplyResult> }) {
  const t = useTranslations("buyer.assistant");
  const link = "inline-flex min-h-11 items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground";

  if (view.kind === "proposal") return <ProposalCard view={view} onApply={onApply} />;

  if (view.kind === "choices") {
    return (
      <section className="glass space-y-3 px-4 py-4">
        <p className="font-medium">{view.question}</p>
        <div className="flex flex-wrap gap-2">
          {view.options.map((label) => (
            <Button key={label} variant="outline" onClick={() => onChoose?.(label)}>
              {label}
            </Button>
          ))}
        </div>
      </section>
    );
  }

  if (view.kind === "suggestions") {
    return (
      <Pane>
        {view.items.map((s, i) => (
          <div key={i} className="py-3">
            <p className="font-medium">{s.name}</p>
            <p className="text-sm text-muted-foreground">{s.supplier} · {s.hint}</p>
          </div>
        ))}
      </Pane>
    );
  }

  if (view.kind === "products") {
    if (view.groups.length === 0) return <Pane><p className="py-3 text-sm text-muted-foreground">{t("noProducts", { query: view.title })}</p></Pane>;
    return (
      <div className="space-y-3">
        {view.groups.map((g) => (
          <Pane key={g.supplier}>
            <p className="pt-3 text-sm font-semibold">{g.supplier}</p>
            <div>
              {g.items.map((p) => (
                <ProductCard key={p.id} product={p} layout="row" />
              ))}
            </div>
            {g.more ? (
              <Link href={g.more.href} className={link}>
                {t("moreProducts", { count: g.more.count })}
                <ChevronRight aria-hidden className="size-4" />
              </Link>
            ) : null}
          </Pane>
        ))}
      </div>
    );
  }

  if (view.kind === "suppliers") {
    return (
      <Pane>
        {view.items.map((s) => (
          <Link key={s.id} href={s.href} className="flex items-center gap-3 py-3 transition-colors hover:text-brand">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{s.name}</span>
              <span className="block text-sm text-muted-foreground">
                {[s.city, s.minOrder ? t("minOrder", { amount: s.minOrder }) : null, s.delivery].filter(Boolean).join(" · ")}
              </span>
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </Pane>
    );
  }

  if (view.kind === "orders") {
    if (view.items.length === 0) return <Pane><p className="py-3 text-sm text-muted-foreground">{t("noOrders")}</p></Pane>;
    return (
      <Pane>
        {view.items.map((o) => (
          <OrderRow key={o.id} order={o} />
        ))}
        <Link href={view.allHref} className={link}>
          {t("allOrders")}
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      </Pane>
    );
  }

  if (view.kind === "order") {
    return (
      <Pane>
        <OrderRow order={view.order} />
        <ul className="pb-2">
          {view.lines.map((l, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0">{l.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{l.qty} · {l.total}</span>
            </li>
          ))}
        </ul>
        <Link href={view.order.href} className={link}>
          {t("openOrder")}
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      </Pane>
    );
  }

  // cart
  if (view.carts.length === 0) return <Pane><p className="py-3 text-sm text-muted-foreground">{t("emptyCart")}</p></Pane>;
  return (
    <div className="space-y-3">
      {view.carts.map((c) => (
        <Pane key={c.supplier}>
          <p className="pt-3 text-sm font-semibold">{c.supplier}</p>
          <ul>
            {c.lines.map((l, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                <span className="min-w-0">{l.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{l.qty} · {l.total}</span>
              </li>
            ))}
          </ul>
          <p className="flex justify-between py-2 text-sm font-semibold tabular-nums">
            <span>{t("total")}</span>
            <span>{c.total}</span>
          </p>
          {c.shortfall ? <p className="pb-1 text-sm text-[var(--status-amber-fg)]">{t("shortfall", { amount: c.shortfall })}</p> : null}
          <Link href={c.href} className={link}>
            {t("openCart")}
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        </Pane>
      ))}
    </div>
  );
}

function Pane({ children }: { children: React.ReactNode }) {
  return <section className="glass px-4">{children}</section>;
}

function OrderRow({ order }: { order: OrderSnap }) {
  return (
    <Link href={order.href} className="flex items-start gap-3 py-3 transition-colors hover:text-brand">
      <span className="min-w-0 flex-1">
        <span className="block font-medium leading-snug">{order.supplier}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-full", DOT[order.status])} />
            {order.statusLabel}
          </span>
          <span className="tabular-nums">{order.number}</span>
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-semibold tabular-nums">{order.total}</span>
        {order.deliveryDay ? <span className="block text-sm text-muted-foreground">{order.deliveryDay}</span> : null}
      </span>
    </Link>
  );
}

/**
 * A change the assistant proposes: what will change, then Confirm and Cancel. Nothing happens before the tap; the answer from the
 * server (done, or why not) replaces the buttons. The state lives in the card, so it survives the thread scrolling.
 */
function ProposalCard({ view, onApply }: { view: ProposalView; onApply?: (action: ProposalAction) => Promise<ApplyResult> }) {
  const t = useTranslations("buyer.assistant");
  const [state, setState] = useState<{ phase: "idle" | "working" | "cancelled" } | { phase: "done"; message: string; href: string | null } | { phase: "failed"; error: string }>({ phase: "idle" });

  async function confirm() {
    if (!onApply) return;
    setState({ phase: "working" });
    const result = await onApply(view.action).catch(() => ({ ok: false as const, error: "failed" }));
    if (result.ok) setState({ phase: "done", message: result.message, href: result.href });
    else setState({ phase: "failed", error: result.error });
  }

  return (
    <section className="glass space-y-3 px-4 py-4" aria-label={view.title}>
      <p className="font-semibold">{view.title}</p>
      <ul>
        {view.rows.map((r, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
            <span className="min-w-0">{r.label}</span>
            <span className="shrink-0 tabular-nums">
              {r.before ? <span className="text-muted-foreground">{r.before} → </span> : null}
              <span className="font-medium">{r.after ?? "–"}</span>
            </span>
          </li>
        ))}
      </ul>
      {view.note ? <p className="text-sm text-muted-foreground">{view.note}</p> : null}
      {state.phase === "done" ? (
        <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium">
          <span className="inline-flex items-center gap-1.5"><Check aria-hidden className="size-4 text-brand" />{state.message}</span>
          {state.href ? <Link href={state.href} className="text-brand hover:underline">{t("openPage")}</Link> : null}
        </p>
      ) : state.phase === "cancelled" ? (
        <p role="status" className="text-sm text-muted-foreground">{t("cancelled")}</p>
      ) : (
        <>
          {state.phase === "failed" ? (
            <p role="alert" className="text-sm text-destructive">{t(`errors.${(["invalid", "not_found", "failed", "product_unavailable", "invalid_quantity", "limit_reached", "empty", "rate_limited", "not_available"].includes(state.error) ? state.error : "failed") as "failed"}`)}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant={view.danger ? "danger" : "default"} loading={state.phase === "working"} loadingLabel={t("working")} onClick={() => void confirm()}>
              {state.phase === "working" ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
              {view.confirmLabel}
            </Button>
            <Button variant="outline" disabled={state.phase === "working"} onClick={() => setState({ phase: "cancelled" })}>
              {t("cancel")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
