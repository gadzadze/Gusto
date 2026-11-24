import { getFormatter, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/app-shell/page-header";
import { requireAdmin } from "@/server/auth/guards";
import { listAllowedEmails } from "@/server/domain/admin/access";
import { AccessManager } from "./access-manager";

export default async function AdminAccessPage() {
  const t = await getTranslations("admin.access");
  return (
    <>
      <PageHeader title={t("title")} />
      <p className="-mt-3 mb-6 max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>
      <Access />
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
          role: r.intendedRole,
          businessName: r.businessName,
          legalId: r.legalId,
          revoked: r.revokedAt !== null,
          addedAt: format.dateTime(r.createdAt, { dateStyle: "medium" }),
        }))}
      />
    </div>
  );
}
