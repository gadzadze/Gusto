import { BadgePercent, ChevronRight } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { CreatePriceList } from "@/components/pricing/create-price-list";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSupplier } from "@/server/auth/guards";
import { listPriceLists } from "@/server/domain/pricing/price-lists";

export default async function PricingPage() {
  const t = await getTranslations("pricing");
  return (
    <>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <PriceLists />
      </Suspense>
    </>
  );
}

async function PriceLists() {
  const ctx = await requireSupplier();
  const t = await getTranslations("pricing");
  const lists = await listPriceLists(ctx);
  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>
      <CreatePriceList disabled={ctx.orgStatus === "suspended"} />
      {lists.length === 0 ? (
        <EmptyState icon={BadgePercent} title={t("emptyTitle")} body={t("emptyBody")} />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {lists.map((l) => (
            <li key={l.id}>
              <Link href={`/supplier/pricing/${l.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{l.name}</span>
                  {l.isDefault ? <Badge tone="brand" className="ml-2">{t("default")}</Badge> : null}
                  <span className="block text-sm text-muted-foreground">
                    {t("customers", { count: l.customerCount })} · {t("overrides", { count: l.overrideCount })}
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
