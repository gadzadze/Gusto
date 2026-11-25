import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/app-shell/page-header";
import { SAMPLE_CATALOG } from "@/lib/voice/order-parse";
import { requireAdmin } from "@/server/auth/guards";
import { geminiConfigured } from "@/server/voice/gemini";
import { VoiceTest } from "./voice-test";

export default async function VoiceTestPage() {
  const t = await getTranslations("admin.voiceTest");
  return (
    <>
      <PageHeader title={t("title")} />
      <p className="-mt-3 mb-6 max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>
      <Body />
    </>
  );
}

async function Body() {
  await requireAdmin();
  return <VoiceTest configured={geminiConfigured()} sampleCatalog={SAMPLE_CATALOG} />;
}
