import { Store } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SupplierStatusBadge } from "@/components/admin/supplier-status-badge";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/guards";
import type { OrgStatus } from "@/server/db/schema";
import { countSuppliersByStatus, listSuppliersForAdmin } from "@/server/domain/admin/suppliers";

const FILTERS = ["all", "pending_review", "active", "suspended"] as const;

export default async function AdminSuppliersPage({ searchParams }: PageProps<"/admin/suppliers">) {
  const t = await getTranslations("admin");
  return (
    <>
      <PageHeader title={t("suppliersTitle")} />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Suppliers searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Suppliers({ searchParams }: Pick<PageProps<"/admin/suppliers">, "searchParams">) {
  const ctx = await requireAdmin();
  const t = await getTranslations("admin");
  const format = await getFormatter();
  const { status: raw } = await searchParams;
  const status = FILTERS.find((f) => f === raw && f !== "all") as OrgStatus | undefined;

  const [suppliers, counts] = await Promise.all([listSuppliersForAdmin(ctx, status), countSuppliersByStatus(ctx)]);
  const total = counts.pending_review + counts.active + counts.suspended;

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-2" aria-label={t("columns.status")}>
        {FILTERS.map((f) => {
          const active = (status ?? "all") === f;
          const n = f === "all" ? total : counts[f];
          return (
            <Link
              key={f}
              href={f === "all" ? "/admin/suppliers" : `/admin/suppliers?status=${f}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 md:min-h-9 items-center gap-2 rounded-full border px-3 text-sm",
                active ? "border-brand bg-brand-soft text-brand" : "border-border hover:bg-muted",
              )}
            >
              {t(`statusFilter.${f}`)}
              <span className="tabular-nums text-muted-foreground">{n}</span>
            </Link>
          );
        })}
      </nav>

      {suppliers.length === 0 ? (
        <EmptyState icon={Store} title={t("suppliersEmpty")} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{t("columns.name")}</TH>
              <TH className="hidden sm:table-cell">{t("columns.city")}</TH>
              <TH>{t("columns.status")}</TH>
              <TH className="hidden text-right sm:table-cell">{t("columns.products")}</TH>
              <TH className="hidden md:table-cell">{t("columns.registered")}</TH>
            </TR>
          </THead>
          <TBody>
            {suppliers.map((s) => (
              <TR key={s.id} className="hover:bg-muted/50">
                <TD>
                  <Link href={`/admin/suppliers/${s.id}`} className="font-medium hover:underline">
                    {s.name}
                  </Link>
                </TD>
                <TD className="hidden text-muted-foreground sm:table-cell">{s.city}</TD>
                <TD><SupplierStatusBadge status={s.status} /></TD>
                <TD className="hidden text-right tabular-nums sm:table-cell">{s.productCount}</TD>
                <TD className="hidden text-muted-foreground md:table-cell">
                  {format.dateTime(s.createdAt, { dateStyle: "medium" })}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
