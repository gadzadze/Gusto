import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalDocument } from "@/components/legal/legal-document";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.terms");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

// Static and public: linked from the landing page, sign-in and the supplier request form.
export default function TermsPage() {
  return <LegalDocument doc="terms" />;
}
