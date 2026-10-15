import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ReviewPanel } from "@/components/admin/review-panel";
import { SupplierStatusBadge } from "@/components/admin/supplier-status-badge";
import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/server/auth/guards";
import { VerificationCard } from "@/components/admin/verification-card";
import { getBuyerForAdmin, getVerificationInfo } from "@/server/domain/admin/organizations";
import { NotFoundError } from "@/server/domain/errors";
import { reviewBuyerAction } from "../actions";

export default async function AdminBuyerPage(props: PageProps<"/admin/organizations/[id]">) {
  const t = await getTranslations("admin.orgs");
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3 text-muted-foreground">
        <Link href="/admin/organizations">
          <ArrowLeft />
          {t("back")}
        </Link>
      </Button>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Buyer {...props} />
      </Suspense>
    </>
  );
}

async function Buyer({ params }: PageProps<"/admin/organizations/[id]">) {
  const ctx = await requireAdmin();
  const t = await getTranslations("admin");
  const to = await getTranslations("admin.orgs");
  const format = await getFormatter();
  const { id } = await params;
  const { org, owners, orderCount } = await getBuyerForAdmin(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const info = await getVerificationInfo(ctx, org.id);
  const none = t("detail.none");
  return (
    <div className="space-y-6">
      <PageHeader title={org.name} actions={<SupplierStatusBadge status={org.status} />} />
      <p className="-mt-4 text-sm text-muted-foreground">
        {t("detail.registered", { date: format.dateTime(org.createdAt, { dateStyle: "medium" }) })} ·{" "}
        {to("orders", { count: orderCount })}
      </p>
      <ReviewPanel orgId={org.id} status={org.status} review={reviewBuyerAction} />
      <VerificationCard info={info} />
      <Card>
        <CardHeader>
          <CardTitle>{t("detail.contact")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">{t("detail.city")}</dt>
              <dd>{org.city}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{org.contactName}</dt>
              <dd className="tabular-nums">{org.phone}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("detail.owners")}</dt>
              <dd>
                {owners.map((o, i) => (
                  <span key={i} className="block">
                    {[o.fullName, o.phone].filter(Boolean).join(" · ") || none}
                  </span>
                ))}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
