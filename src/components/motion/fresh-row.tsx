"use client";

import { useEffect, useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/utils";

// A row that arrives while a supplier has the page open (a new order in the live queue) gets a short highlight, so it
// is noticed instead of silently shifting the list. Only the live poller can say that something arrived:
// `expectArrivals()` is called right before it refreshes the page, and rows that mount in the next few seconds and
// were not seen before are the new ones. Rows that load with the page, navigation to another page, and a changed
// filter or brand toggle never fall in that window, so they never animate. Browser only: nothing is recorded
// or highlighted while rendering on the server.
const ARRIVAL_WINDOW_MS = 8_000;
const MAX_REMEMBERED = 500;
const seen = new Set<string>();
let arrivalsUntil = 0;

/** Called by the live poller just before it refreshes the page: unseen rows that mount now are new arrivals. */
export function expectArrivals(now = Date.now()) {
  arrivalsUntil = now + ARRIVAL_WINDOW_MS;
}

/** Forget everything (the live page was left). */
export function resetRows() {
  seen.clear();
  arrivalsUntil = 0;
}

export function isFreshRow(id: string, now = Date.now()) {
  return now < arrivalsUntil && !seen.has(id);
}

export function rememberRow(id: string) {
  if (seen.size >= MAX_REMEMBERED) seen.clear(); // bounded: only ever needed for rows on the open page
  seen.add(id);
}

export function FreshRow({
  id,
  as: Tag = "div",
  className,
  children,
}: {
  id: string;
  as?: "div" | "li";
  className?: string;
  children: React.ReactNode;
}) {
  // Decided once, when the row first mounts in the browser (never on the server, where there is no page to watch).
  const [fresh] = useState(() => typeof window !== "undefined" && isFreshRow(id));
  useEffect(() => {
    rememberRow(id);
  }, [id]);
  return <Tag className={cn(className, fresh && "animate-row-in")}>{children}</Tag>;
}
