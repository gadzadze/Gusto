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
  const [suppliers, categories] = await Promise.all([countSuppliersByStatus(ctx), listAllCategories(ctx)]);
  const tiles = [
    { label: t("pendingSuppliers"), value: suppliers.pending_review, href: "/admin/suppliers?status=pending_review", cta: t("review") },
    { label: t("activeSuppliers"), value: suppliers.active, href: "/admin/suppliers?status=active", cta: t("manage") },
    { label: t("categories"), value: categories.filter((c) => !c.isArchived).length, href: "/admin/categories", cta: t("manage") },
  ];
  return (
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
  );
}
