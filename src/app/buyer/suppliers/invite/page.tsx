import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { InviteSupplierForm } from "@/components/buyer/invite-supplier-form";
import { SupplierInviteList } from "@/components/buyer/supplier-invite-list";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPhone } from "@/lib/phone";
import { requireBuyer } from "@/server/auth/guards";
import { listSupplierInvites } from "@/server/domain/buyer/supplier-invites";

export default async function InviteSupplierPage() {
  const t = await getTranslations("supplierInvite");
  return (
    <>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-64 w-full max-w-xl" />}>
        <Invite />
      </Suspense>
    </>
  );
}

async function Invite() {
  const ctx = await requireBuyer();
  const t = await getTranslations("supplierInvite");
  const format = await getFormatter();
  const invites = await listSupplierInvites(ctx);
  const canInvite = ctx.orgStatus === "active";
  return (
    <div className="space-y-8">
      <p className="max-w-xl text-sm text-muted-foreground">{canInvite ? t("intro") : t("errors.not_active")}</p>
      {canInvite ? <InviteSupplierForm /> : null}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("list.title")}</h2>
        <SupplierInviteList
          rows={invites.map((i) => ({
            id: i.id,
            supplierName: i.supplierName,
            contact: [i.contactPhone ? formatPhone(i.contactPhone) : null, i.contactEmail].filter(Boolean).join(" · "),
            state: i.state,
            requestStatus: i.requestStatus,
            createdAt: format.dateTime(i.createdAt, { dateStyle: "medium" }),
          }))}
        />
      </section>
    </div>
  );
}
