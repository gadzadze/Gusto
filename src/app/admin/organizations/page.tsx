import { Building2 } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SupplierStatusBadge } from "@/components/admin/supplier-status-badge";
import { PageHeader } from "@/components/app-shell/page-header";
import { Pagination } from "@/components/app-shell/pagination";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/guards";
import { listOrganizations } from "@/server/domain/admin/organizations";

const TYPES = ["all", "supplier", "buyer"] as const;

export default async function AdminOrganizationsPage({ searchParams }: PageProps<"/admin/organizations">) {
  const t = await getTranslations("admin.orgs");
  return (
    <>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Organizations searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Organizations({ searchParams }: Pick<PageProps<"/admin/organizations">, "searchParams">) {
  const ctx = await requireAdmin();
  const t = await getTranslations("admin.orgs");
  const tc = await getTranslations("admin.columns");
  const tcommon = await getTranslations("common");
  const format = await getFormatter();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const type = params.type === "supplier" || params.type === "buyer" ? params.type : undefined;
  const status = params.status === "pending_review" ? "pending_review" : undefined;
  const page = Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1;
  const list = await listOrganizations(ctx, { q, type, status, page });

  const href = (nextType: string) => {
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (nextType !== "all") s.set("type", nextType);
    if (status) s.set("status", status);
    const qs = s.toString();
    return qs ? `/admin/organizations?${qs}` : "/admin/organizations";
  };

  return (
    <div className="space-y-5">
      <form className="flex gap-2" role="search">
        {type ? <input type="hidden" name="type" value={type} /> : null}
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <Input name="q" defaultValue={q} placeholder={t("searchPlaceholder")} aria-label={tcommon("search")} className="max-w-sm" />
        <Button type="submit" variant="outline">{tcommon("search")}</Button>
      </form>
      <nav className="flex flex-wrap gap-2" aria-label={t("title")}>
        {TYPES.map((f) => {
          const active = (type ?? "all") === f;
          return (
            <Link
              key={f}
              href={href(f)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 md:min-h-9 items-center rounded-full border px-3 text-sm",
                active ? "border-brand bg-brand-soft text-brand" : "border-border hover:bg-muted",
              )}
            >
              {t(`type.${f}`)}
            </Link>
          );
        })}
      </nav>
      {list.items.length === 0 ? (
        <EmptyState icon={Building2} title={t("empty")} />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{tc("name")}</TH>
                <TH className="hidden sm:table-cell">{t("type.all")}</TH>
                <TH className="hidden sm:table-cell">{tc("legalId")}</TH>
                <TH className="hidden sm:table-cell">{tc("city")}</TH>
                <TH>{tc("status")}</TH>
                <TH className="hidden md:table-cell">{tc("registered")}</TH>
              </TR>
            </THead>
            <TBody>
              {list.items.map((o) => (
                <TR key={o.id} className="hover:bg-muted/50">
                  <TD>
                    <Link
                      href={o.type === "supplier" ? `/admin/suppliers/${o.id}` : `/admin/organizations/${o.id}`}
                      className="font-medium hover:underline"
                    >
                      {o.name}
                    </Link>
                  </TD>
                  <TD className="hidden text-muted-foreground sm:table-cell">{t(`typeLabel.${o.type}`)}</TD>
                  <TD className="hidden tabular-nums text-muted-foreground sm:table-cell">{o.legalId ?? "—"}</TD>
                  <TD className="hidden text-muted-foreground sm:table-cell">{o.city}</TD>
                  <TD><SupplierStatusBadge status={o.status} /></TD>
                  <TD className="hidden text-muted-foreground md:table-cell">
                    {format.dateTime(o.createdAt, { dateStyle: "medium" })}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination
            basePath="/admin/organizations"
            params={{ q: q || undefined, type, status }}
            page={list.page}
            pageCount={list.pageCount}
          />
        </>
      )}
    </div>
  );
}
