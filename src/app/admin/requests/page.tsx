import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { isFreeMailAddress } from "@/lib/legal-id";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/guards";
import { listSupplierRequests } from "@/server/domain/admin/supplier-requests";
import { RequestList } from "./request-list";

const FILTERS = ["open", "approved", "rejected"] as const;

export default async function AdminRequestsPage({ searchParams }: PageProps<"/admin/requests">) {
  const t = await getTranslations("admin.requests");
  return (
    <>
      <PageHeader title={t("title")} />
      <p className="-mt-3 mb-6 max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>
      <Suspense fallback={<Skeleton className="h-64 w-full max-w-3xl" />}>
        <Requests searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Requests({ searchParams }: Pick<PageProps<"/admin/requests">, "searchParams">) {
  const ctx = await requireAdmin();
  const t = await getTranslations("admin.requests");
  const format = await getFormatter();
  const params = await searchParams;
  const filter = params.filter === "approved" || params.filter === "rejected" ? params.filter : "open";
  const all = await listSupplierRequests(ctx);
  const rows = all.filter((r) => (filter === "open" ? r.status === "new" || r.status === "contacted" : r.status === filter));

  return (
    <div className="max-w-3xl space-y-5">
      <nav className="flex flex-wrap gap-2" aria-label={t("title")}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "open" ? "/admin/requests" : `/admin/requests?filter=${f}`}
            aria-current={filter === f ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 md:min-h-9 items-center rounded-full border px-3 text-sm",
              filter === f ? "border-brand bg-brand-soft text-brand" : "border-border hover:bg-muted",
            )}
          >
            {t(`filter.${f}`)}
          </Link>
        ))}
      </nav>
      <RequestList
        rows={rows.map((r) => ({
          id: r.id,
          businessName: r.businessName,
          legalId: r.legalId,
          contactName: r.contactName,
          phone: r.phone,
          email: r.email,
          city: r.city,
          note: r.note,
          adminNote: r.adminNote,
          status: r.status,
          freeMail: isFreeMailAddress(r.email),
          createdAt: format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "short" }),
        }))}
      />
    </div>
  );
}
