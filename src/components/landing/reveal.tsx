"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Milliseconds to wait after the element enters, for a quiet stagger between siblings. */
  delay?: number;
  /** Direction it settles from. */
  from?: "up" | "left" | "right";
  /** Reveal the direct children one after another instead of the element as a whole. */
  stagger?: boolean;
};

/**
 * Scroll-triggered entrance: the element fades and settles into place the
 * first time it is clearly on screen. The server renders it visible; the
 * hidden state is armed on the client only for elements below the fold, so
 * without JavaScript (or for print, or Reduce Motion) nothing is ever hidden.
 */
export function Reveal({ children, className = "", delay = 0, from = "up", stagger = false }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Already on screen at load: the hero has its own arrival, leave it be.
    if (el.getBoundingClientRect().top < window.innerHeight - 40) return;
    el.classList.add("rv-hidden");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.classList.remove("rv-hidden");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const style = delay ? ({ "--rv-delay": `${delay}ms` } as CSSProperties) : undefined;
  return (
    <div ref={ref} className={`rv rv-${from}${stagger ? " rv-stagger" : ""} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}
