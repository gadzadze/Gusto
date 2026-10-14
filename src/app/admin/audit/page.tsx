import { ScrollText } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { Pagination } from "@/components/app-shell/pagination";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/server/auth/guards";
import { listAuditActions, listAuditLog } from "@/server/domain/admin/audit-log";

export default async function AdminAuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const t = await getTranslations("admin.audit");
  return (
    <>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Audit searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

async function Audit({ searchParams }: Pick<PageProps<"/admin/audit">, "searchParams">) {
  const ctx = await requireAdmin();
  const t = await getTranslations("admin.audit");
  const format = await getFormatter();
  const params = await searchParams;
  const filters = {
    actor: str(params.actor),
    action: str(params.action),
    from: str(params.from),
    to: str(params.to),
    page: Number.parseInt(str(params.page) || "1", 10) || 1,
  };
  const [list, actions] = await Promise.all([listAuditLog(ctx, filters), listAuditActions(ctx)]);

  return (
    <div className="space-y-5">
      <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end" role="search">
        <div className="space-y-2">
          <Label htmlFor="actor">{t("actor")}</Label>
          <Input id="actor" name="actor" defaultValue={filters.actor} placeholder={t("actorPlaceholder")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="action">{t("action")}</Label>
          <Select id="action" name="action" defaultValue={filters.action}>
            <option value="">{t("allActions")}</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="from">{t("from")}</Label>
          <Input id="from" name="from" type="date" defaultValue={filters.from} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="to">{t("to")}</Label>
          <Input id="to" name="to" type="date" defaultValue={filters.to} />
        </div>
        <div className="flex gap-2">
          <Button type="submit">{t("apply")}</Button>
          <Button asChild variant="ghost"><a href="/admin/audit">{t("reset")}</a></Button>
        </div>
      </form>
      <p className="text-sm text-muted-foreground">{t("total", { count: list.total })}</p>
      {list.items.length === 0 ? (
        <EmptyState icon={ScrollText} title={t("empty")} />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{t("when")}</TH>
                <TH>{t("actor")}</TH>
                <TH>{t("action")}</TH>
                <TH className="hidden md:table-cell">{t("target")}</TH>
                <TH className="hidden lg:table-cell">{t("details")}</TH>
              </TR>
            </THead>
            <TBody>
              {list.items.map((row) => (
                <TR key={row.id}>
                  <TD className="whitespace-nowrap text-muted-foreground">
                    {format.dateTime(row.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                  </TD>
                  <TD>{row.actorEmail ?? row.actorLabel ?? t("system")}</TD>
                  <TD className="font-mono text-xs">{row.action}</TD>
                  <TD className="hidden md:table-cell">
                    <span className="text-muted-foreground">{row.targetType}</span>{" "}
                    <span className="font-mono text-xs">{row.targetId.slice(0, 8)}</span>
                  </TD>
                  <TD className="hidden max-w-xs truncate font-mono text-xs text-muted-foreground lg:table-cell">
                    {row.data ? JSON.stringify(row.data) : ""}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination
            basePath="/admin/audit"
            params={{
              actor: filters.actor || undefined,
              action: filters.action || undefined,
              from: filters.from || undefined,
              to: filters.to || undefined,
            }}
            page={list.page}
            pageCount={list.pageCount}
          />
        </>
      )}
    </div>
  );
}
