import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Panel, PanelRow } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OrgStatus } from "@/server/db/schema";
import type { PilotMetrics } from "@/server/domain/metrics/pilot";
import type { HealthReport } from "@/server/health";

const STATUS_COLOR = {
  pending: "bg-amber-500",
  confirmed: "bg-blue-600",
  delivered: "bg-green-600",
  rejected: "bg-stone-400",
  cancelled: "bg-stone-400",
} as const;

export type AdminOverviewProps = {
  suppliers: Record<OrgStatus, number>;
  pendingBuyers: number;
  newRequests: number;
  pilot: PilotMetrics;
  health: HealthReport;
};

/** The admin's home: what needs a decision today, then how the pilot is going. */
export async function AdminOverview({ suppliers, pendingBuyers, newRequests, pilot, health }: AdminOverviewProps) {
  const ta = await getTranslations("admin.attention");
  const tp = await getTranslations("admin.pilot");
  const ts = await getTranslations("orderStatus");
  const tst = await getTranslations("admin.status");
  const format = await getFormatter();
  const pendingBusinesses = suppliers.pending_review + pendingBuyers;
  const attention = [
    newRequests > 0 && { key: "requests", title: ta("requests", { count: newRequests }), hint: ta("requestsHint"), href: "/admin/requests", action: ta("requestsAction") },
    pendingBusinesses > 0 && {
      key: "pending",
      title: ta("pending", { count: pendingBusinesses }),
      hint: ta("pendingHint"),
      href: suppliers.pending_review > 0 ? "/admin/suppliers?status=pending_review" : "/admin/organizations?status=pending_review",
      action: ta("pendingAction"),
    },
    !health.ok && { key: "health", title: ta("health"), hint: ta("healthHint"), href: null, action: null },
  ].filter(Boolean) as { key: string; title: string; hint: string; href: string | null; action: string | null }[];

  const percent = pilot.reorder.rate === null ? tp("none") : `${Math.round(pilot.reorder.rate * 100)}%`;
  const perSupplier = pilot.ordersPerSupplierPerWeek === null ? tp("none") : format.number(pilot.ordersPerSupplierPerWeek, { maximumFractionDigits: 1 });
  const metrics = [
    { key: "suppliers", label: tp("activeSuppliers"), value: String(pilot.activeSuppliers), hint: `${tp("activeSuppliersHint")} · ${ta("goalSuppliers")}`, bar: null as number | null },
    { key: "buyers", label: tp("activeBuyers"), value: String(pilot.activeBuyers), hint: tp("activeBuyersHint"), bar: null },
    {
      key: "reorder",
      label: tp("reorder"),
      value: percent,
      hint: pilot.reorder.earlierWeekBuyers === 0 ? tp("reorderNone") : tp("reorderDetail", { both: pilot.reorder.bothWeeksBuyers, earlier: pilot.reorder.earlierWeekBuyers }),
      bar: pilot.reorder.rate,
    },
    { key: "perSupplier", label: tp("perSupplier"), value: perSupplier, hint: tp("perSupplierHint"), bar: null },
  ];
  const orderEntries = (Object.entries(pilot.ordersByStatus30d) as [keyof typeof pilot.ordersByStatus30d, number][]).filter(([, n]) => n > 0);
  const orderTotal = orderEntries.reduce((sum, [, n]) => sum + n, 0);

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1.55fr_1fr]">
      <div className="space-y-5">
        <Panel id="attention" title={ta("title")}>
          {attention.length === 0 ? (
            <PanelRow>
              <span className="size-2 shrink-0 rounded-full bg-green-600" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{ta("clear")}</p>
                <p className="text-sm text-muted-foreground">{ta("clearHint")}</p>
              </div>
            </PanelRow>
          ) : (
            attention.map((item) => (
              <PanelRow key={item.key}>
                <span className="size-2 shrink-0 rounded-full bg-brand" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.hint}</p>
                </div>
                {item.href && item.action ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={item.href}>{item.action}</Link>
                  </Button>
                ) : null}
              </PanelRow>
            ))
          )}
        </Panel>

        <Panel id="pilot" title={tp("title")}>
          <p className="border-b border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">{tp("intro")}</p>
          {metrics.map((m) => (
            <div key={m.key} className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border px-4 py-3.5 last:border-b-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{m.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{m.hint}</p>
                {m.bar !== null ? (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round(m.bar * 100)}%` }} />
                  </div>
                ) : null}
              </div>
              <p className="text-2xl font-semibold tabular-nums">{m.value}</p>
            </div>
          ))}
        </Panel>
      </div>

      <div className="space-y-5">
        <section aria-labelledby="orders30" className="rounded-xl border border-border bg-surface px-4 py-4">
          <h2 id="orders30" className="text-sm text-muted-foreground">{tp("orders30")}</h2>
          <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{orderTotal}</p>
          {orderTotal > 0 ? (
            <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={orderEntries.map(([s, n]) => `${ts(s)}: ${n}`).join(", ")}>
              {orderEntries.map(([s, n]) => (
                <span key={s} className={cn("h-full", STATUS_COLOR[s])} style={{ width: `${(n / orderTotal) * 100}%` }} />
              ))}
            </div>
          ) : null}
          <ul className="mt-3 space-y-1.5 text-sm">
            {(Object.entries(pilot.ordersByStatus30d) as [keyof typeof pilot.ordersByStatus30d, number][]).map(([s, n]) => (
              <li key={s} className="flex items-center gap-2">
                <span className={cn("size-2 rounded-sm", STATUS_COLOR[s])} aria-hidden />
                {ts(s)}
                <b className="ml-auto tabular-nums">{n}</b>
              </li>
            ))}
          </ul>
        </section>

        <Panel id="network" title={tp("suppliers")}>
          {(["pending_review", "active", "suspended"] as const).map((status) => (
            <PanelRow key={status} className="justify-between">
              <span className="text-sm text-muted-foreground">{tst(status)}</span>
              <b className="tabular-nums">{pilot.suppliersByStatus[status]}</b>
            </PanelRow>
          ))}
          <PanelRow className="justify-between">
            <span className="text-sm text-muted-foreground">{tp("buyerOrgs")}</span>
            <b className="tabular-nums">{pilot.buyerOrgs}</b>
          </PanelRow>
          <PanelRow className="justify-between">
            <span className="text-sm text-muted-foreground">{tp("activeProducts")}</span>
            <b className="tabular-nums">{pilot.activeProducts}</b>
          </PanelRow>
        </Panel>
      </div>
    </div>
  );
}
