import { Clock, Inbox, PauseCircle, Truck } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/app-shell/page-header";
import { BarRow, SparkBars } from "@/components/dashboard/bars";
import { GetStarted, type SetupProgress } from "@/components/dashboard/get-started";
import { Panel, PanelRow } from "@/components/dashboard/panel";
import { ReviewSheet } from "@/components/orders/review-sheet";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
import type { OrgStatus } from "@/server/db/schema";
import type { SupplierMetrics } from "@/server/domain/metrics/supplier";
import type { PendingQueueItem, UpcomingDelivery } from "@/server/domain/orders/today";
import { getFormats } from "@/server/i18n/formats";

// Orders that have waited longer than this are marked, so the oldest ones are answered first.
const LATE_AFTER_MS = 4 * 60 * 60 * 1000;

export type SupplierTodayProps = {
  title: string;
  orgStatus: OrgStatus;
  counts: { new: number; confirmed: number; done: number };
  metrics: SupplierMetrics;
  queue: PendingQueueItem[];
  deliveries: UpcomingDelivery[];
  series: { day: string; valueMinor: number }[];
  clock: { timezone: string; today: string };
  now: Date;
  /** What the company has prepared; only read while it has no orders at all (the "get started" checklist). */
  setup?: SetupProgress;
};

/** The supplier's home: what needs an answer, what goes out next, and the shape of the last 30 days. */
export async function SupplierToday({ title, orgStatus, counts, metrics, queue, deliveries, series, clock, now, setup }: SupplierTodayProps) {
  const fmt = await getFormats();
  const format = await getFormatter();
  const t = await getTranslations("supplier");
  const td = await getTranslations("supplier.dashboard");
  const tt = await getTranslations("supplier.today");
  const tu = await getTranslations("units");
  const to = await getTranslations("orders");
  const total = counts.new + counts.confirmed + counts.done;
  const dayOf = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const delta = metrics.ordersThisWeek - metrics.ordersLastWeek;
  const topMax = Math.max(...metrics.topProducts.map((p) => p.confirmedQtyMilli), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        subtitle={format.dateTime(now, { dateStyle: "full", timeZone: clock.timezone })}
        actions={
          total > 0 ? (
            <Button asChild>
              <Link href="/supplier/orders/pick">
                <Truck />
                {tt("loadingSheet")}
              </Link>
            </Button>
          ) : null
        }
      />
      {orgStatus === "pending_review" ? (
        <Notice icon={Clock} tone="amber" title={t("pendingTitle")}>
          {t("pendingBody")}
        </Notice>
      ) : null}
      {orgStatus === "suspended" ? (
        <Notice icon={PauseCircle} title={t("suspendedTitle")}>
          {t("suspendedBody")}
        </Notice>
      ) : null}
      {total === 0 ? (
        setup ? (
          <GetStarted progress={setup} canInvite={orgStatus === "active"} />
        ) : (
          <EmptyState icon={Inbox} title={t("emptyTitle")} body={t("emptyBody")} />
        )
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[1.55fr_1fr]">
          <div className="space-y-5">
            <Panel id="queue" title={tt("queueTitle")} count={counts.new} action={{ href: "/supplier/orders", label: tt("queueAll") }}>
              {queue.length === 0 ? (
                <p className="px-4 py-5 text-sm text-muted-foreground">{tt("queueEmpty")}</p>
              ) : (
                queue.map((o) => {
                  const late = now.getTime() - o.createdAt.getTime() > LATE_AFTER_MS;
                  const number = to("number", { number: o.number });
                  return (
                    <PanelRow key={o.id}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{o.buyerName}</p>
                        <p className="text-sm text-muted-foreground">
                          <span className="tabular-nums">{number}</span> · {tt("items", { count: o.itemCount })} ·{" "}
                          <span className={cn(late && "font-semibold text-amber-800 dark:text-amber-300")}>
                            {format.relativeTime(o.createdAt, now)}
                          </span>
                        </p>
                      </div>
                      <span className="hidden whitespace-nowrap font-medium tabular-nums sm:block">{fmt.money(o.totalMinor, o.currency)}</span>
                      <ReviewSheet orderId={o.id} number={number} buyerName={o.buyerName} label={tt("review")} />
                    </PanelRow>
                  );
                })
              )}
            </Panel>

            <Panel id="deliveries" title={tt("deliveriesTitle")}>
              {deliveries.length === 0 ? (
                <p className="px-4 py-5 text-sm text-muted-foreground">{tt("deliveriesEmpty")}</p>
              ) : (
                deliveries.map((d) => {
                  const isToday = d.date === clock.today;
                  const late = d.date !== null && d.date < clock.today;
                  return (
                    <PanelRow key={d.date ?? "none"}>
                      <div
                        className={cn(
                          "w-12 shrink-0 rounded-lg border py-1 text-center",
                          isToday ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface-2",
                        )}
                        aria-hidden
                      >
                        {d.date ? (
                          <>
                            <b className="block text-base leading-tight tabular-nums">{format.dateTime(dayOf(d.date), { day: "numeric", timeZone: "UTC" })}</b>
                            <span className="text-[11px] text-muted-foreground">{format.dateTime(dayOf(d.date), { weekday: "short", timeZone: "UTC" })}</span>
                          </>
                        ) : (
                          <b className="block py-1 text-base">?</b>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {d.date ? format.dateTime(dayOf(d.date), { dateStyle: "medium", timeZone: "UTC" }) : tt("noDay")}
                          {isToday ? <span className="ml-2 text-xs font-medium text-brand">{tt("todayLabel")}</span> : null}
                          {late ? <span className="ml-2 text-xs font-semibold text-amber-800 dark:text-amber-300">{tt("overdue")}</span> : null}
                        </p>
                        <p className="text-sm text-muted-foreground">{tt("deliveryCounts", { orders: d.orders, customers: d.customers })}</p>
                      </div>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/supplier/orders/pick?day=${d.date ?? "none"}`} aria-label={tt("loadingSheet")}>
                          <Truck />
                          <span className="hidden sm:inline">{tt("loadingSheet")}</span>
                        </Link>
                      </Button>
                    </PanelRow>
                  );
                })
              )}
            </Panel>
          </div>

          <div className="space-y-5">
            <section aria-labelledby="value" className="rounded-xl border border-border bg-surface">
              <div className="space-y-1 border-b border-border px-4 py-4">
                <h2 id="value" className="text-sm text-muted-foreground">{td("value")}</h2>
                <p className="text-3xl font-semibold tabular-nums tracking-tight">{fmt.money(metrics.orderValue30dMinor, metrics.currency)}</p>
                <div className="py-2">
                  <SparkBars values={series.map((s) => s.valueMinor)} label={tt("chartLabel")} />
                  {series.length > 1 ? (
                    <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground" aria-hidden>
                      <span>{format.dateTime(dayOf(series[0].day), { day: "numeric", month: "short", timeZone: "UTC" })}</span>
                      <span>{format.dateTime(dayOf(series[series.length - 1].day), { day: "numeric", month: "short", timeZone: "UTC" })}</span>
                    </div>
                  ) : null}
                  {series.some((s) => s.valueMinor > 0) ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">{tt("chartLegend", { best: fmt.money(Math.max(...series.map((s) => s.valueMinor), 0), metrics.currency) })}</p>
                  ) : null}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{td("valueHint")}</p>
              </div>
              <div className="divide-y divide-border">
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <h3 className="text-sm">{td("week")}</h3>
                    <p className="text-xs text-muted-foreground">
                      {delta === 0 ? td("weekPrevious", { count: metrics.ordersLastWeek }) : delta > 0 ? tt("deltaUp", { count: delta }) : tt("deltaDown", { count: -delta })}
                    </p>
                  </div>
                  <p className="text-2xl font-semibold tabular-nums">{metrics.ordersThisWeek}</p>
                </div>
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <h3 className="text-sm">{td("repeat")}</h3>
                    <p className="text-xs text-muted-foreground">{td("repeatHint")}</p>
                  </div>
                  <p className="text-2xl font-semibold tabular-nums">{metrics.repeatBuyers30d}</p>
                </div>
              </div>
            </section>

            <Panel id="top" title={td("top")}>
              {metrics.topProducts.length === 0 ? (
                <p className="px-4 py-5 text-sm text-muted-foreground">{td("topEmpty")}</p>
              ) : (
                metrics.topProducts.map((p, i) => (
                  <BarRow
                    key={`${p.name}-${i}`}
                    label={p.name}
                    value={`${fmt.input(p.confirmedQtyMilli)} ${tu(p.unit)}`}
                    ratio={p.confirmedQtyMilli / topMax}
                  />
                ))
              )}
              <p className="px-4 pb-3 text-xs text-muted-foreground">{td("topHint")}</p>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
