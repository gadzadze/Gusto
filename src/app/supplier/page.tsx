import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { DashboardSkeleton } from "@/components/dashboard/skeletons";
import { PushSettings } from "@/components/push/push-settings";
import { pushPublicKey } from "@/server/notifications/push";
import { LiveOrders } from "@/components/orders/live-orders";
import { SupplierToday } from "@/components/dashboard/supplier-today";
import { requireSupplier } from "@/server/auth/guards";
import { getSupplierMetrics } from "@/server/domain/metrics/supplier";
import { countSupplierOrders } from "@/server/domain/orders/queries";
import { getOrderValueSeries, getPendingPulse, getSetupProgress, getSupplierClock, listPendingQueue, listUpcomingDeliveries } from "@/server/domain/orders/today";

export default function SupplierDashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const ctx = await requireSupplier();
  const t = await getTranslations("supplier");
  const [counts, metrics, queue, deliveries, series, clock, pulse] = await Promise.all([
    countSupplierOrders(ctx),
    getSupplierMetrics(ctx),
    listPendingQueue(ctx, 6),
    listUpcomingDeliveries(ctx, 5),
    getOrderValueSeries(ctx, 30),
    getSupplierClock(ctx),
    getPendingPulse(ctx),
  ]);
  // A company with no orders at all gets a "get started" checklist instead of an empty home.
  const setup = counts.new + counts.confirmed + counts.done === 0 ? await getSetupProgress(ctx) : undefined;
  return (
    <>
    <LiveOrders signature={pulse.signature} pending={pulse.pending} />
    {pushPublicKey() ? <div className="mb-5"><PushSettings publicKey={pushPublicKey() as string} variant="nudge" /></div> : null}
    <SupplierToday
      title={t("dashboardTitle")}
      orgStatus={ctx.orgStatus}
      counts={counts}
      metrics={metrics}
      queue={queue}
      deliveries={deliveries}
      series={series}
      clock={clock}
      now={new Date()}
      setup={setup}
    />
    </>
  );
}
