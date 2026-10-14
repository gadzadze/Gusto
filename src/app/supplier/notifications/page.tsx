import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { NotificationsView } from "@/components/notifications/notifications-view";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSupplier } from "@/server/auth/guards";

export default async function SupplierNotificationsPage({ searchParams }: PageProps<"/supplier/notifications">) {
  const t = await getTranslations("notifications");
  return (
    <>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-64 w-full max-w-3xl" />}>
        <List searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function List({ searchParams }: Pick<PageProps<"/supplier/notifications">, "searchParams">) {
  const ctx = await requireSupplier();
  const params = await searchParams;
  const page = Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1;
  return <NotificationsView userId={ctx.userId} area="supplier" page={page} />;
}
