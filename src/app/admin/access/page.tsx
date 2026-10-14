import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/server/auth/guards";
import { listAllowedEmails } from "@/server/domain/admin/access";
import { AccessManager } from "./access-manager";

export default async function AdminAccessPage() {
  const t = await getTranslations("admin.access");
  return (
    <>
      <PageHeader title={t("title")} />
      <p className="-mt-3 mb-6 max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>
      <Suspense fallback={<Skeleton className="h-64 w-full max-w-3xl" />}>
        <Access />
      </Suspense>
    </>
  );
}

async function Access() {
  const ctx = await requireAdmin();
  const format = await getFormatter();
  const rows = await listAllowedEmails(ctx);
  return (
    <div className="max-w-3xl">
      <AccessManager
        rows={rows.map((r) => ({
          id: r.id,
          email: r.email,
          note: r.note,
          revoked: r.revokedAt !== null,
          addedAt: format.dateTime(r.createdAt, { dateStyle: "medium" }),
        }))}
      />
    </div>
  );
}
