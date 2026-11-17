import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { TeamSection } from "@/components/team/team-section";
import { Skeleton } from "@/components/ui/skeleton";
import { requireBuyer } from "@/server/auth/guards";

export default async function BuyerTeamPage() {
  const t = await getTranslations("team");
  return (
    <>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-96 w-full max-w-2xl" />}>
        <Team />
      </Suspense>
    </>
  );
}

async function Team() {
  const ctx = await requireBuyer();
  return <TeamSection ctx={ctx} />;
}
