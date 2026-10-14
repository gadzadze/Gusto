import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { NotificationsView } from "@/components/notifications/notifications-view";
import { Skeleton } from "@/components/ui/skeleton";
import { requireBuyer } from "@/server/auth/guards";

export default async function BuyerNotificationsPage({ searchParams }: PageProps<"/buyer/notifications">) {
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

async function List({ searchParams }: Pick<PageProps<"/buyer/notifications">, "searchParams">) {
  const ctx = await requireBuyer();
  const params = await searchParams;
  const page = Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1;
  return <NotificationsView userId={ctx.userId} area="buyer" page={page} />;
}
