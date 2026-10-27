import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LandingNav } from "@/components/landing/nav";
import { nunito } from "@/components/landing/landing-font";
import { BuyerPhone, HeroComposite, SupplierMock, TrustCard, buildTourViews } from "@/components/landing/panels";
import { ProductTour } from "@/components/landing/product-tour";
import { Reveal } from "@/components/landing/reveal";
import { ScrollDepth } from "@/components/landing/scroll-depth";
import "@/components/landing/landing.css";

// Static: no session read here, so it prerenders. "Sign in" goes through
// /start, which sends signed-in users straight to their dashboard. Every screen
// on this page is a drawn mock-up with fictional data; the hero says so.

export default async function LandingPage() {
  const t = await getTranslations("landing");
  const tabs = [t("tour.tab1"), t("tour.tab2"), t("tour.tab3"), t("tour.tab4")];
  const views = await buildTourViews();
  const facts = [
    { title: t("facts.freeTitle"), body: t("facts.freeBody") },
    { title: t("facts.feeTitle"), body: t("facts.feeBody") },
    { title: t("facts.webTitle"), body: t("facts.webBody") },
    { title: t("facts.inviteTitle"), body: t("facts.inviteBody") },
  ];
  const supplierPoints = [
    { title: t("suppliers.c1Title"), body: t("suppliers.c1Body") },
    { title: t("suppliers.c2Title"), body: t("suppliers.c2Body") },
    { title: t("suppliers.c3Title"), body: t("suppliers.c3Body") },
  ];
  const buyerPoints = [
    { title: t("buyers.c1Title"), body: t("buyers.c1Body") },
    { title: t("buyers.c2Title"), body: t("buyers.c2Body") },
    { title: t("buyers.c3Title"), body: t("buyers.c3Body") },
  ];
  const trustPoints = [
    { title: t("trust.i1Title"), body: t("trust.i1Body") },
    { title: t("trust.i2Title"), body: t("trust.i2Body") },
    { title: t("trust.i3Title"), body: t("trust.i3Body") },
    { title: t("trust.i4Title"), body: t("trust.i4Body") },
  ];
  const footerLinks = [
    { href: "#product", label: t("nav.product") },
    { href: "#suppliers", label: t("nav.suppliers") },
    { href: "#buyers", label: t("nav.buyers") },
    { href: "#trust", label: t("nav.trust") },
  ];

  return (
    <div className={`lp ${nunito.variable}`}>
      <LandingNav />

      <main id="top">
        {/* Hero */}
        <section className="hero">
          <div className="wrap">
            <div className="hero-grid">
              <div className="hero-copy arrive">
                <h1 className="h1">{t("hero.title")}</h1>
                <p className="lead">{t("hero.body")}</p>
                <div className="hero-cta">
                  <Link className="btn" href="/suppliers">
                    {t("hero.cta")}
                  </Link>
                  <a className="more" href="#product">
                    {t("hero.how")}
                  </a>
                </div>
              </div>
              <ScrollDepth className="depth">
                <HeroComposite />
              </ScrollDepth>
            </div>

            <div className="facts">
              <Reveal className="facts-in" stagger>
                {facts.map((f) => (
                  <div key={f.title} className="fact">
                    <b>{f.title}</b>
                    <span>{f.body}</span>
                  </div>
                ))}
              </Reveal>
            </div>
          </div>
        </section>

        {/* Product tour */}
        <section className="section" id="product">
          <div className="wrap">
            <Reveal className="sec-head">
              <p className="kicker">{t("tour.kicker")}</p>
              <h2 className="h2">{t("tour.title")}</h2>
            </Reveal>
            <Reveal className="tour-wrap" delay={120}>
              <ProductTour label={t("tour.aria")} tabs={tabs} views={views} />
            </Reveal>
          </div>
        </section>

        {/* Suppliers */}
        <section className="section alt" id="suppliers">
          <div className="wrap">
            <div className="split">
              <Reveal className="split-text">
                <p className="kicker">{t("suppliers.kicker")}</p>
                <h2 className="h2">{t("suppliers.title")}</h2>
                <p className="body">{t("suppliers.body")}</p>
                <ul className="checks">
                  {supplierPoints.map((p) => (
                    <li key={p.title}>
                      {p.title}
                      <span>{p.body}</span>
                    </li>
                  ))}
                </ul>
                <Link className="more" href="/suppliers">
                  {t("suppliers.cta")}
                </Link>
              </Reveal>
              <Reveal from="right" delay={120}>
                <SupplierMock />
              </Reveal>
            </div>
          </div>
        </section>

        {/* Buyers */}
        <section className="section" id="buyers">
          <div className="wrap">
            <div className="split rev">
              <Reveal className="split-text">
                <p className="kicker">{t("buyers.kicker")}</p>
                <h2 className="h2">{t("buyers.title")}</h2>
                <p className="body">{t("buyers.body")}</p>
                <ul className="checks">
                  {buyerPoints.map((p) => (
                    <li key={p.title}>
                      {p.title}
                      <span>{p.body}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
              <Reveal from="left" delay={120}>
                <BuyerPhone />
              </Reveal>
            </div>
          </div>
        </section>

        {/* Trust */}
        <section className="night" id="trust">
          <div className="wrap">
            <div className="trust">
              <Reveal className="split-text">
                <p className="kicker">{t("trust.kicker")}</p>
                <h2 className="h2">{t("trust.title")}</h2>
                <p className="body">{t("trust.body")}</p>
              </Reveal>
              <Reveal from="right" delay={120}>
                <TrustCard />
              </Reveal>
            </div>
            <Reveal className="trust-list" stagger>
              {trustPoints.map((p) => (
                <div key={p.title} className="trust-item">
                  <b>{p.title}</b>
                  <span>{p.body}</span>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        {/* Close */}
        <section className="close" id="join">
          <div className="wrap">
            <div className="close-grid">
              <Reveal className="close-copy">
                <h2 className="h2">{t("close.title")}</h2>
                <p className="body">{t("close.body")}</p>
                <div className="hero-cta">
                  <Link className="btn" href="/suppliers">
                    {t("close.cta")}
                  </Link>
                  <Link className="more" href="/start">
                    {t("close.signIn")}
                  </Link>
                </div>
              </Reveal>
              <Reveal className="close-side" stagger delay={120}>
                <div>
                  <b className="h3">{t("close.sTitle")}</b>
                  <p>{t("close.sBody")}</p>
                  <Link className="more" href="/suppliers">
                    {t("close.sCta")}
                  </Link>
                </div>
                <div>
                  <b className="h3">{t("close.bTitle")}</b>
                  <p>{t("close.bBody")}</p>
                  <Link className="more" href="/start">
                    {t("close.bCta")}
                  </Link>
                </div>
              </Reveal>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap foot-in">
          <Image src="/brand/gusto-wordmark.svg" alt="Gusto" width={78} height={22} unoptimized />
          <nav className="foot-links" aria-label={t("nav.aria")}>
            {footerLinks.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
          <span>{t("footer")}</span>
        </div>
      </footer>
    </div>
  );
}
