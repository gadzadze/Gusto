"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

const NavBadgesContext = createContext<Record<string, number>>({});

/** Counts shown next to menu items, keyed by href (suppliers waiting for approval, orders waiting for an answer, ...). */
export function useNavBadges(): Record<string, number> {
  return useContext(NavBadgesContext);
}

const PENDING_KEY = "/supplier/orders";
const POLL_MS = 45_000;
const MAX_FAILURES = 3;

/**
 * Holds the menu badges. The shell is rendered by the server once per visit, so a count in it goes stale while a
 * person moves between pages. For a supplier, the number of orders waiting for an answer (the Orders item) is
 * therefore refreshed from /api/supplier/pulse every 45 s while the tab is visible, and at once when it comes
 * back. Whenever the server renders the shell again (for example after a refresh) its fresh counts win.
 */
export function NavBadgesProvider({ initial, pollPending, children }: { initial?: Record<string, number>; pollPending: boolean; children: React.ReactNode }) {
  const key = JSON.stringify(initial ?? {});
  const [live, setLive] = useState<{ key: string; pending: number } | null>(null);

  useEffect(() => {
    if (!pollPending) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let failures = 0;

    const run = async () => {
      if (stopped) return;
      if (!document.hidden) {
        try {
          const res = await fetch("/api/supplier/pulse", { cache: "no-store", credentials: "same-origin" });
          if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error("pulse");
          const data = (await res.json()) as { pending: number };
          failures = 0;
          if (!stopped) setLive({ key, pending: data.pending });
        } catch {
          failures += 1; // signed out, offline or struggling: back off, then stop
        }
      }
      if (!stopped && failures < MAX_FAILURES) timer = setTimeout(run, POLL_MS);
    };
    const onVisible = () => {
      if (document.hidden) return;
      clearTimeout(timer);
      failures = 0;
      void run();
    };

    timer = setTimeout(run, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollPending, key]);

  const value = useMemo(() => {
    const base = initial ?? {};
    return live && live.key === key ? { ...base, [PENDING_KEY]: live.pending } : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, live]);

  return <NavBadgesContext.Provider value={value}>{children}</NavBadgesContext.Provider>;
}
