import { getTranslations } from "next-intl/server";
import { PushSettings } from "@/components/push/push-settings";
import { pushPublicKey } from "@/server/notifications/push";
import { LiveOrders } from "@/components/orders/live-orders";
import { SupplierToday } from "@/components/dashboard/supplier-today";
import { requireSupplier } from "@/server/auth/guards";
import { voiceOrderEnabled } from "@/server/voice/config";
import { getSupplierMetrics } from "@/server/domain/metrics/supplier";
import { countSupplierOrders } from "@/server/domain/orders/queries";
import { getPendingPulse, getSetupProgress, getSupplierClock, listPendingQueue, listUpcomingDeliveries } from "@/server/domain/orders/today";

export default function SupplierDashboardPage() {
  return (
    <Dashboard />
  );
}

async function Dashboard() {
  const ctx = await requireSupplier();
  const t = await getTranslations("supplier");
  const [counts, metrics, queue, deliveries, clock, pulse] = await Promise.all([
    countSupplierOrders(ctx),
    getSupplierMetrics(ctx),
    listPendingQueue(ctx, 6),
    listUpcomingDeliveries(ctx, 5),
    getSupplierClock(ctx),
    getPendingPulse(ctx),
  ]);
  // A company with no orders at all gets a "get started" checklist instead of an empty home.
  const setup = counts.new + counts.confirmed + counts.done === 0 ? await getSetupProgress(ctx) : undefined;
  // Starting points for the assistant: the label follows the page language, the command is always Georgian (what it listens for).
  const assistantOn = voiceOrderEnabled() && ctx.orgStatus === "active";
  const tv = await getTranslations("buyer.voice");
  const tvKa = await getTranslations({ locale: "ka", namespace: "buyer.voice" });
  const assistantChips = assistantOn
    ? (["Waiting", "Tomorrow", "Restock"] as const).map((k) => ({ label: tv(`supplierChip${k}`), command: tvKa(`supplierChip${k}`) }))
    : [];
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
      clock={clock}
      now={new Date()}
      setup={setup}
      assistantChips={assistantChips}
    />
    </>
  );
}
