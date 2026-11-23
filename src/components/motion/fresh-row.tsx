"use client";

import { useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/utils";

// Rows that arrived while the page was already open (a new order in the live queue) get a short highlight, so they
// are noticed instead of silently shifting the list. Rows that were there when the page loaded never animate:
// `live` turns on only once the page's live poller has started, and ids are remembered for the page's lifetime.
const seen = new Set<string>();
let live = false;

export function setRowsLive(value: boolean) {
  live = value;
  if (!value) seen.clear();
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
  const [fresh] = useState(() => {
    const isNew = live && !seen.has(id);
    seen.add(id);
    return isNew;
  });
  return <Tag className={cn(className, fresh && "animate-row-in")}>{children}</Tag>;
}
