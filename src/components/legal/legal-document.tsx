import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { LocaleSwitch } from "@/components/locale-switch";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { LEGAL_UPDATED, legalOperator } from "@/lib/legal";

type Section = {
  title: string;
  paragraphs?: string[];
  items?: string[];
  closing?: string[];
};

// One layout for both documents. The wording lives in messages/ka.json under
// `legal`, so it is edited in one place and never hardcoded in a component.
export async function LegalDocument({ doc }: { doc: "terms" | "privacy" }) {
  const t = await getTranslations("legal");
  const format = await getFormatter();
  const sections = (doc === "terms" ? t.raw("terms.sections") : t.raw("privacy.sections")) as Section[];
  const operator = legalOperator();
  const updated = format.dateTime(new Date(`${LEGAL_UPDATED}T12:00:00Z`), {
    dateStyle: "long",
    timeZone: "Asia/Tbilisi",
  });
  const otherDoc =
    doc === "terms"
      ? { href: "/privacy", label: t("common.privacyLink") }
      : { href: "/terms", label: t("common.termsLink") };
  const operatorRows = operator
    ? [
        { label: t("common.operatorName"), value: operator.name },
        { label: t("common.operatorId"), value: operator.id },
        { label: t("common.operatorAddress"), value: operator.address },
        { label: t("common.operatorEmail"), value: operator.email, href: operator.email ? `mailto:${operator.email}` : null },
      ].filter((row) => row.value)
    : [];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <LocaleSwitch />
          <Button asChild variant="outline" size="sm">
            <Link href="/start">{t("common.signIn")}</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <article className="py-8 sm:py-12">
          <h1 className="break-words text-2xl font-semibold leading-tight sm:text-4xl sm:leading-tight">
            {doc === "terms" ? t("terms.title") : t("privacy.title")}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">{t("common.updated", { date: updated })}</p>
          <p className="mt-6 text-base leading-7">{doc === "terms" ? t("terms.intro") : t("privacy.intro")}</p>

          <nav aria-label={t("common.toc")} className="mt-8 rounded-xl border border-border p-4 sm:p-5">
            <p className="text-sm font-semibold">{t("common.toc")}</p>
            <ol className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              {sections.map((section, index) => (
                <li key={section.title} className="flex gap-2">
                  <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
                  <a href={`#section-${index + 1}`} className="underline-offset-2 hover:underline">
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="mt-4">
            {sections.map((section, index) => (
              <section
                key={section.title}
                id={`section-${index + 1}`}
                aria-labelledby={`section-${index + 1}-title`}
                className="scroll-mt-6 pt-8"
              >
                <h2 id={`section-${index + 1}-title`} className="break-words text-xl font-semibold">
                  {index + 1}. {section.title}
                </h2>
                {section.paragraphs?.map((text) => (
                  <p key={text} className="mt-3 text-base leading-7">
                    {text}
                  </p>
                ))}
                {section.items && (
                  <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-7">
                    {section.items.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                )}
                {section.closing?.map((text) => (
                  <p key={text} className="mt-3 text-base leading-7">
                    {text}
                  </p>
                ))}
              </section>
            ))}
          </div>

          {operatorRows.length > 0 && (
            <section aria-labelledby="operator-title" className="mt-10 rounded-xl border border-border bg-muted/40 p-5 sm:p-6">
              <h2 id="operator-title" className="text-lg font-semibold">
                {t("common.operatorTitle")}
              </h2>
              <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
                {operatorRows.map((row) => (
                  <div key={row.label} className="contents">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="break-words">
                      {row.href ? (
                        <a href={row.href} className="text-brand underline-offset-2 hover:underline">
                          {row.value}
                        </a>
                      ) : (
                        row.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </article>
      </main>

      <footer className="border-t border-border">
        <nav
          aria-label={t("common.navAria")}
          className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground sm:px-6"
        >
          <Link href="/" className="hover:text-foreground">
            {t("common.home")}
          </Link>
          <Link href={otherDoc.href} className="hover:text-foreground">
            {otherDoc.label}
          </Link>
        </nav>
      </footer>
    </div>
  );
}
