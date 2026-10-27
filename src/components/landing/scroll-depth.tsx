"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Publishes how far the page has scrolled (0 to 800, unitless) as `--sy` on its
 * own element, so CSS can nudge the hero's layers at different speeds. Skipped
 * entirely for Reduce Motion and once the hero is out of view.
 */
export function ScrollDepth({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      el.style.setProperty("--sy", String(Math.min(window.scrollY, 800)));
    };
    const onScroll = () => {
      if (!frame && window.scrollY < 900) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
