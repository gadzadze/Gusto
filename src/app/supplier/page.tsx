import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LiveOrders } from "@/components/orders/live-orders";
import { SupplierToday } from "@/components/dashboard/supplier-today";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSupplier } from "@/server/auth/guards";
import { getSupplierMetrics } from "@/server/domain/metrics/supplier";
import { countSupplierOrders } from "@/server/domain/orders/queries";
import { getOrderValueSeries, getPendingPulse, getSupplierClock, listPendingQueue, listUpcomingDeliveries } from "@/server/domain/orders/today";

export default function SupplierDashboardPage() {
  return (
    <Suspense fallback={<Skeleton className="h-48 w-full" />}>
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
  return (
    <>
    <LiveOrders signature={pulse.signature} pending={pulse.pending} />
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
    />
    </>
  );
}
