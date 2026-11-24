import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/app-shell/page-header";
import { TeamSection } from "@/components/team/team-section";
import { requireSupplier } from "@/server/auth/guards";

export default async function SupplierTeamPage() {
  const t = await getTranslations("team");
  return (
    <>
      <PageHeader title={t("title")} />
      <Team />
    </>
  );
}

async function Team() {
  const ctx = await requireSupplier();
  return <TeamSection ctx={ctx} />;
}
