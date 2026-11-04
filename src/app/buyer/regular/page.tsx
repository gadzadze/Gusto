import { CalendarClock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { RegularOrderButtons } from "@/components/orders/regular-order-controls";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { requireBuyer } from "@/server/auth/guards";
import { listRegularOrders } from "@/server/domain/orders/regular";

export default async function RegularOrdersPage() {
  const t = await getTranslations("regular");
  return (
    <>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <RegularOrders />
      </Suspense>
    </>
  );
}

async function RegularOrders() {
  const ctx = await requireBuyer();
  const t = await getTranslations("regular");
  const list = await listRegularOrders(ctx);
  if (list.length === 0) return <EmptyState icon={CalendarClock} title={t("emptyTitle")} body={t("emptyBody")} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {list.map((r) => (
          <li key={r.id} className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.name}</span>
              {r.dueToday ? <Badge tone="brand">{t("dueToday")}</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {r.supplierName} · {t("every", { day: t(`days.${r.weekday as 1}`) })}
            </p>
            <p className="text-sm text-muted-foreground">{r.itemNames.join(", ")}</p>
            <RegularOrderButtons id={r.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}
