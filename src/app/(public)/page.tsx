import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Static: no session read here, so it prerenders. "Sign in" goes through
// /start, which sends signed-in users straight to their dashboard.
export default async function LandingPage() {
  const t = await getTranslations("landing");
  const tb = await getTranslations("brand");

  const columns = [
    {
      title: t("suppliersTitle"),
      points: [t("suppliersPoint1"), t("suppliersPoint2"), t("suppliersPoint3")],
    },
    {
      title: t("buyersTitle"),
      points: [t("buyersPoint1"), t("buyersPoint2"), t("buyersPoint3")],
    },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <Button asChild variant="outline" size="sm">
          <Link href="/start">{t("signIn")}</Link>
        </Button>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 sm:px-6">
        <section className="py-14 sm:py-24">
          <Badge tone="brand">{tb("pilot")}</Badge>
          <h1 className="mt-5 max-w-2xl text-3xl font-semibold leading-tight sm:text-5xl sm:leading-tight">
            {t("heroTitle")}
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">{t("heroBody")}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="lg">
              <Link href="/start">
                {t("getStarted")}
                <ArrowRight />
              </Link>
            </Button>
            <p className="text-sm text-muted-foreground">{t("freeNote")}</p>
          </div>
        </section>

        <section className="grid gap-4 pb-16 sm:grid-cols-2">
          {columns.map((column) => (
            <div key={column.title} className="rounded-xl border border-border bg-surface-2 p-6">
              <h2 className="font-semibold">{column.title}</h2>
              <ul className="mt-4 space-y-3">
                {column.points.map((point) => (
                  <li key={point} className="flex gap-3 text-sm">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-muted-foreground sm:px-6">
          {t("footer")}
        </div>
      </footer>
    </div>
  );
}
