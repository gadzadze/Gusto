import { getTranslations } from "next-intl/server";
import { isDemoMode } from "@/lib/demo";

/** A thin strip on every page of the public demo. Renders nothing otherwise. */
export async function DemoBanner() {
  if (!isDemoMode()) return null;
  const t = await getTranslations("demo");
  return (
    <p className="bg-brand-soft px-4 py-2 text-center text-sm text-foreground print:hidden">{t("banner")}</p>
  );
}
