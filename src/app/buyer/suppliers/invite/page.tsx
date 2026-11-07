import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { PersonalInviteLink } from "@/components/buyer/personal-invite-link";
import { InviteSupplierForm } from "@/components/buyer/invite-supplier-form";
import { SupplierInviteList } from "@/components/buyer/supplier-invite-list";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPhone } from "@/lib/phone";
import { requireBuyer } from "@/server/auth/guards";
import { serverEnv } from "@/server/env";
import { getInviteLink, listSupplierInvites } from "@/server/domain/buyer/supplier-invites";

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
  // The text to paste goes to a supplier whose language we don't know: Georgian, as the preview shows.
  const tText = await getTranslations({ locale: "ka", namespace: "supplierInvite" });
  const format = await getFormatter();
  const invites = await listSupplierInvites(ctx);
  const canInvite = ctx.orgStatus === "active";
  const token = canInvite ? await getInviteLink(ctx) : null;
  const url = token ? `${serverEnv().NEXT_PUBLIC_APP_URL}/suppliers/invite/${token}` : null;
  return (
    <div className="space-y-8">
      {canInvite ? (
        <>
          <PersonalInviteLink initial={url ? { url, text: tText("orderFooter", { link: url }) } : null} />
          <section className="space-y-3">
            <h2 className="font-semibold">{t("namedTitle")}</h2>
            <p className="max-w-xl text-sm text-muted-foreground">{t("namedIntro")}</p>
            <InviteSupplierForm />
          </section>
        </>
      ) : (
        <p className="max-w-xl text-sm text-muted-foreground">{t("errors.not_active")}</p>
      )}
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
