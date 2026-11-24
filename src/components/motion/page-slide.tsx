import { ViewTransition } from "react";

/* Directional page motion (2026-11-24). A link that goes deeper carries the `nav-forward` transition type, a link that
   comes back carries `nav-back` (`transitionTypes` on next/link); the page wrapped here slides out and in accordingly
   (CSS in globals.css). Without a type (browser back, refresh, a tab change, a Suspense reveal) it does nothing, and a
   browser without view transitions just navigates. Put it in `page.tsx`, never in a layout: a layout persists, so its
   enter and exit would never fire. */
const direction = { "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" } as const;

export function PageSlide({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter={direction} exit={direction} default="none">
      {children}
    </ViewTransition>
  );
}
