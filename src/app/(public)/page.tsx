import { ArrowRight, BadgeCheck, EyeOff, HandCoins, Gift } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { HeroPhone } from "@/components/landing/hero-phone";
import { Reveal } from "@/components/landing/reveal";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Static: no session read here, so it prerenders. "Sign in" goes through
// /start, which sends signed-in users straight to their dashboard. Screens are
// real screenshots of the app with clearly fictional demo data (the page says so).

type ShotProps = { src: string; alt: string; kind: "phone" | "desktop"; width: number; height: number };

function Shot({ src, alt, kind, width, height }: ShotProps) {
  if (kind === "phone") {
    return (
      <div className="mx-auto w-[260px] overflow-hidden rounded-[2.5rem] border-[10px] border-[#0b0b0c] bg-background shadow-[0_30px_80px_-20px_rgba(11,11,12,0.45)] sm:w-[300px]">
        <Image src={src} alt={alt} width={width} height={height} unoptimized className="block h-auto w-full" />
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-[0_30px_80px_-30px_rgba(11,11,12,0.35)]">
      <div className="flex gap-1.5 border-b border-border bg-surface-2 px-4 py-3">
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
      </div>
      <Image src={src} alt={alt} width={width} height={height} unoptimized className="block h-auto w-full" />
    </div>
  );
}

function Feature({
  eyebrow,
  title,
  body,
  reverse,
  wide,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  reverse?: boolean;
  /** A wide (desktop) screen: text on top, the screen big underneath. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  if (wide) {
    return (
      <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-medium text-brand">{eyebrow}</p>
          <h2 className="mt-3 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">{title}</h2>
          <p className="mx-auto mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground">{body}</p>
        </Reveal>
        <Reveal className="mt-12 sm:mt-16" delay={120}>
          {children}
        </Reveal>
      </section>
    );
  }
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-28">
      <div className={cn("grid items-center gap-12 md:grid-cols-2 md:gap-20", reverse && "md:[&>*:first-child]:order-2")}>
        <Reveal>
          <p className="text-sm font-medium text-brand">{eyebrow}</p>
          <h2 className="mt-3 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">{title}</h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-muted-foreground">{body}</p>
        </Reveal>
        <Reveal delay={120}>{children}</Reveal>
      </div>
    </section>
  );
}

export default async function LandingPage() {
  const t = await getTranslations("landing");
  const tb = await getTranslations("brand");

  const steps = [
    { n: "1", title: t("step1Title"), body: t("step1Body") },
    { n: "2", title: t("step2Title"), body: t("step2Body") },
    { n: "3", title: t("step3Title"), body: t("step3Body") },
  ];
  const principles = [
    { icon: Gift, title: t("p1Title"), body: t("p1Body") },
    { icon: HandCoins, title: t("p2Title"), body: t("p2Body") },
    { icon: EyeOff, title: t("p3Title"), body: t("p3Body") },
    { icon: BadgeCheck, title: t("p4Title"), body: t("p4Body") },
  ];

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Logo />
          <nav className="flex items-center gap-1 sm:gap-3" aria-label={tb("name")}>
            <Link href="/suppliers" className="inline-flex min-h-11 items-center px-3 text-sm text-muted-foreground hover:text-foreground">
              {t("navSuppliers")}
            </Link>
            <Button asChild variant="outline" size="sm">
              <Link href="/start">{t("signIn")}</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-10 pt-16 text-center sm:px-6 sm:pt-28">
          <p className="inline-flex rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-brand">{tb("pilot")}</p>
          <h1 className="mx-auto mt-6 max-w-4xl text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">{t("heroTitle")}</h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl">{t("heroBody")}</p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/suppliers">
                {t("ctaRequest")}
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <Link href="/start">{t("signIn")}</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{t("freeNote")}</p>
          <div className="mt-14 sm:mt-20">
            <HeroPhone />
            <p className="mt-6 text-xs text-muted-foreground">{t("demo.caption")}</p>
          </div>
        </section>

        {/* The shift */}
        <section className="bg-[#0b0b0c] text-[#f5f5f4]">
          <Reveal className="mx-auto w-full max-w-4xl px-4 py-24 text-center sm:px-6 sm:py-40">
            <p className="text-2xl text-[#a8a29e] sm:text-4xl">{t("beforeLine")}</p>
            <p className="mt-6 text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">{t("afterLine")}</p>
          </Reveal>
        </section>

        <Feature eyebrow={t("f1Eyebrow")} title={t("f1Title")} body={t("f1Body")}>
          <Shot kind="phone" src="/landing/buyer-catalog.png" alt={t("f1Alt")} width={780} height={1688} />
        </Feature>

        <Feature eyebrow={t("f2Eyebrow")} title={t("f2Title")} body={t("f2Body")} reverse>
          <Shot kind="phone" src="/landing/buyer-orders.png" alt={t("f2Alt")} width={780} height={1688} />
        </Feature>

        <Feature wide eyebrow={t("f3Eyebrow")} title={t("f3Title")} body={t("f3Body")}>
          <Shot kind="desktop" src="/landing/supplier-order.png" alt={t("f3Alt")} width={1440} height={900} />
        </Feature>

        <Feature wide eyebrow={t("f4Eyebrow")} title={t("f4Title")} body={t("f4Body")}>
          <Shot kind="desktop" src="/landing/supplier-invite.png" alt={t("f4Alt")} width={1440} height={900} />
        </Feature>

        <Feature wide eyebrow={t("f5Eyebrow")} title={t("f5Title")} body={t("f5Body")}>
          <Shot kind="desktop" src="/landing/supplier-dashboard.png" alt={t("f5Alt")} width={1440} height={900} />
        </Feature>

        <p className="mx-auto max-w-6xl px-4 text-center text-xs text-muted-foreground sm:px-6">{t("screensNote")}</p>

        {/* How it works */}
        <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-32">
          <Reveal>
            <h2 className="text-center text-4xl font-semibold tracking-tight sm:text-5xl">{t("howTitle")}</h2>
          </Reveal>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <Reveal key={s.n} delay={i * 120}>
                <div className="h-full rounded-3xl bg-surface-2 p-8">
                  <p className="text-5xl font-semibold text-brand">{s.n}</p>
                  <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
                  <p className="mt-2 leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Principles */}
        <section className="border-y border-border bg-surface-2">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:grid-cols-2 sm:px-6 sm:py-24 lg:grid-cols-4">
            {principles.map((p, i) => (
              <Reveal key={p.title} delay={i * 100}>
                <p.icon aria-hidden className="size-7 text-brand" />
                <h3 className="mt-4 text-lg font-semibold">{p.title}</h3>
                <p className="mt-1 leading-relaxed text-muted-foreground">{p.body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Closing */}
        <section className="bg-[#7a1f2b] text-[#fafaf9]">
          <div className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6 sm:py-36">
            <Reveal>
              <h2 className="text-center text-5xl font-semibold tracking-tight sm:text-7xl">{t("closeTitle")}</h2>
            </Reveal>
            <div className="mt-14 grid gap-6 md:grid-cols-2">
              <Reveal delay={100}>
                <div className="flex h-full flex-col gap-4 rounded-3xl bg-[#fafaf9]/10 p-8">
                  <h3 className="text-2xl font-semibold">{t("closeSuppliers")}</h3>
                  <p className="leading-relaxed text-[#f6e9eb]">{t("closeSuppliersBody")}</p>
                  <Button asChild size="lg" className="mt-auto w-fit bg-[#fafaf9] text-[#0b0b0c] hover:bg-[#f6e9eb]">
                    <Link href="/suppliers">
                      {t("ctaRequest")}
                      <ArrowRight />
                    </Link>
                  </Button>
                </div>
              </Reveal>
              <Reveal delay={200}>
                <div className="flex h-full flex-col gap-4 rounded-3xl bg-[#fafaf9]/10 p-8">
                  <h3 className="text-2xl font-semibold">{t("closeBuyers")}</h3>
                  <p className="leading-relaxed text-[#f6e9eb]">{t("closeBuyersBody")}</p>
                  <Button asChild size="lg" variant="outline" className="mt-auto w-fit border-[#fafaf9]/60 bg-transparent text-[#fafaf9] hover:bg-[#fafaf9]/10">
                    <Link href="/start">{t("signIn")}</Link>
                  </Button>
                </div>
              </Reveal>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:justify-between sm:px-6">
          <span>{t("footer")}</span>
          <span>{t("footerNote")}</span>
        </div>
      </footer>
    </div>
  );
}
