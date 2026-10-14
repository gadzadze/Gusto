import { Clock, Inbox, PauseCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSupplier } from "@/server/auth/guards";
import { formatMoney } from "@/lib/money";
import { milliToInput } from "@/lib/quantity";
import { StatTile } from "@/components/ui/stat-tile";
import { getSupplierMetrics } from "@/server/domain/metrics/supplier";
import { countSupplierOrders } from "@/server/domain/orders/queries";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default async function SupplierDashboardPage() {
  const t = await getTranslations("supplier");
  return (
    <>
      <PageHeader title={t("dashboardTitle")} />
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <Dashboard />
      </Suspense>
    </>
  );
}

async function Dashboard() {
  const ctx = await requireSupplier();
  const t = await getTranslations("supplier");
  const td = await getTranslations("supplier.dashboard");
  const tu = await getTranslations("units");
  const [counts, metrics] = await Promise.all([countSupplierOrders(ctx), getSupplierMetrics(ctx)]);
  const total = counts.new + counts.confirmed + counts.done;
  return (
    <div className="space-y-6">
      {ctx.orgStatus === "pending_review" ? (
        <Notice icon={Clock} tone="amber" title={t("pendingTitle")}>
          {t("pendingBody")}
        </Notice>
      ) : null}
      {ctx.orgStatus === "suspended" ? (
        <Notice icon={PauseCircle} title={t("suspendedTitle")}>
          {t("suspendedBody")}
        </Notice>
      ) : null}
      {total === 0 ? (
        <EmptyState icon={Inbox} title={t("emptyTitle")} body={t("emptyBody")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <StatTile label={td("pending")} value={metrics.pendingOrders} hint={td("pendingHint")}>
            <Button asChild size="sm" variant={metrics.pendingOrders > 0 ? "default" : "outline"} className="mt-1 w-fit">
              <Link href="/supplier/orders">{td("openPending")}</Link>
            </Button>
          </StatTile>
          <StatTile
            label={td("week")}
            value={metrics.ordersThisWeek}
            note={td("weekPrevious", { count: metrics.ordersLastWeek })}
            hint={td("weekHint")}
          />
          <StatTile
            label={td("value")}
            value={formatMoney(metrics.orderValue30dMinor, metrics.currency)}
            hint={td("valueHint")}
          />
          <StatTile label={td("repeat")} value={metrics.repeatBuyers30d} hint={td("repeatHint")} />
          <div className="sm:col-span-2">
            <StatTile label={td("top")} value="" hint={td("topHint")}>
              {metrics.topProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{td("topEmpty")}</p>
              ) : (
                <ol className="divide-y divide-border">
                  {metrics.topProducts.map((p, i) => (
                    <li key={`${p.name}-${i}`} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                      <span className="min-w-0 truncate">
                        <span className="mr-2 tabular-nums text-muted-foreground">{i + 1}.</span>
                        {p.name}
                      </span>
                      <span className="whitespace-nowrap font-medium tabular-nums">
                        {milliToInput(p.confirmedQtyMilli, ",")} {tu(p.unit)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </StatTile>
          </div>
        </div>
      )}
    </div>
  );
}
