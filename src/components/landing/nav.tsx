"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/** Floating, rounded, blurred pill. Solidifies after a little scrolling; collapses into a sheet on small screens. */
export function LandingNav() {
  const t = useTranslations("landing.nav");
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    { href: "#product", label: t("product") },
    { href: "#suppliers", label: t("suppliers") },
    { href: "#buyers", label: t("buyers") },
    { href: "#trust", label: t("trust") },
  ];

  return (
    <header className="nav">
      <div className="nav-outer">
        <div className={`nav-pill${scrolled || open ? " scrolled" : ""}`}>
          <a href="#top" aria-label="Gusto" onClick={() => setOpen(false)}>
            <Image src="/brand/gusto-wordmark.svg" alt="Gusto" width={85} height={24} priority unoptimized className="nav-logo" />
          </a>
          <nav className="nav-links" aria-label={t("aria")}>
            {links.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
          <div className="nav-right">
            <Link className="plain" href="/start">
              {t("signIn")}
            </Link>
            <a className="btn sm" href="#join">
              {t("join")}
            </a>
            <button
              type="button"
              className={`burger${open ? " open" : ""}`}
              aria-label={open ? t("closeMenu") : t("openMenu")}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <span className="burger-lines" aria-hidden>
                <i />
                <i />
                <i />
              </span>
            </button>
          </div>
        </div>
        {open ? (
          <div className="nav-sheet">
            {links.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </a>
            ))}
            <Link href="/start" onClick={() => setOpen(false)}>
              {t("signIn")}
            </Link>
          </div>
        ) : null}
      </div>
    </header>
  );
}
