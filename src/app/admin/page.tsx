import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/server/auth/guards";
import { countSuppliersByStatus } from "@/server/domain/admin/suppliers";
import { listAllCategories } from "@/server/domain/catalog/categories";
import { StatTile } from "@/components/ui/stat-tile";
import { getPilotMetrics } from "@/server/domain/metrics/pilot";

export default async function AdminOverviewPage() {
  const t = await getTranslations("admin");
  return (
    <>
      <PageHeader title={t("overviewTitle")} />
      <Suspense fallback={<Skeleton className="h-32 w-full" />}>
        <Overview />
      </Suspense>
    </>
  );
}

async function Overview() {
  const ctx = await requireAdmin();
  const t = await getTranslations("admin.overview");
  const tp = await getTranslations("admin.pilot");
  const ts = await getTranslations("orderStatus");
  const [suppliers, categories, pilot] = await Promise.all([
    countSuppliersByStatus(ctx),
    listAllCategories(ctx),
    getPilotMetrics(ctx),
  ]);
  const percent = pilot.reorder.rate === null ? tp("none") : `${Math.round(pilot.reorder.rate * 100)}%`;
  const perSupplier =
    pilot.ordersPerSupplierPerWeek === null ? tp("none") : (Math.round(pilot.ordersPerSupplierPerWeek * 10) / 10).toString().replace(".", ",");
  const tiles = [
    { label: t("pendingSuppliers"), value: suppliers.pending_review, href: "/admin/suppliers?status=pending_review", cta: t("review") },
    { label: t("activeSuppliers"), value: suppliers.active, href: "/admin/suppliers?status=active", cta: t("manage") },
    { label: t("categories"), value: categories.filter((c) => !c.isArchived).length, href: "/admin/categories", cta: t("manage") },
  ];
  return (
    <div className="space-y-8">
    <div className="grid gap-4 sm:grid-cols-3">
      {tiles.map((tile) => (
        <Card key={tile.href}>
          <CardHeader className="pb-2">
            <p className="text-sm text-muted-foreground">{tile.label}</p>
            <p className="text-3xl font-semibold tabular-nums">{tile.value}</p>
          </CardHeader>
          <CardContent>
            <Link href={tile.href} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
              {tile.cta}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </CardContent>
        </Card>
      ))}
    </div>
    <section className="space-y-3" aria-labelledby="pilot">
      <div>
        <h2 id="pilot" className="font-semibold">{tp("title")}</h2>
        <p className="text-sm text-muted-foreground">{tp("intro")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label={tp("activeSuppliers")}
          value={pilot.activeSuppliers}
          hint={tp("activeSuppliersHint")}
        />
        <StatTile label={tp("activeBuyers")} value={pilot.activeBuyers} hint={tp("activeBuyersHint")} />
        <StatTile
          label={tp("reorder")}
          value={percent}
          note={pilot.reorder.earlierWeekBuyers === 0 ? tp("reorderNone") : tp("reorderDetail", { both: pilot.reorder.bothWeeksBuyers, earlier: pilot.reorder.earlierWeekBuyers })}
          hint={tp("reorderHint")}
        />
        <StatTile label={tp("perSupplier")} value={perSupplier} hint={tp("perSupplierHint")} />
        <StatTile
          label={tp("suppliers")}
          value={`${pilot.suppliersByStatus.pending_review} / ${pilot.suppliersByStatus.active} / ${pilot.suppliersByStatus.suspended}`}
          hint={tp("suppliersHint")}
        />
        <StatTile label={tp("buyerOrgs")} value={pilot.buyerOrgs} note={`${tp("activeProducts")}: ${pilot.activeProducts}`} />
        <div className="sm:col-span-2 lg:col-span-3">
          <StatTile label={tp("orders30")} value="">
            <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {(Object.entries(pilot.ordersByStatus30d) as [keyof typeof pilot.ordersByStatus30d, number][]).map(([status, n]) => (
                <li key={status}>
                  {ts(status)}: <span className="font-semibold tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          </StatTile>
        </div>
      </div>
    </section>
    </div>
  );
}
