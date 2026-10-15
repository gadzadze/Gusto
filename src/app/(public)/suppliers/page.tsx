import { Check } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { RequestForm } from "./request-form";

// Static and public: what a supplier sees when a partner forwards them the link.
export default async function SuppliersPage() {
  const t = await getTranslations("supplierRequest");
  const points = [t("point1"), t("point2"), t("point3"), t("point4")];
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/">
          <Logo />
        </Link>
        <Button asChild variant="outline" size="sm">
          <Link href="/start">{t("signIn")}</Link>
        </Button>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <section className="py-10 sm:py-14">
          <h1 className="max-w-xl text-3xl font-semibold leading-tight sm:text-4xl sm:leading-tight">{t("title")}</h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground">{t("intro")}</p>
          <ul className="mt-6 space-y-3">
            {points.map((point) => (
              <li key={point} className="flex gap-3 text-sm sm:text-base">
                <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
                {point}
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-border p-5 sm:p-8" aria-labelledby="request-heading">
          <h2 id="request-heading" className="text-xl font-semibold">{t("formTitle")}</h2>
          <p className="mb-6 mt-2 text-sm text-muted-foreground">{t("formIntro")}</p>
          <RequestForm />
        </section>
      </main>
    </div>
  );
}
