"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A tick box for the loading sheet. It remembers the ticks in this browser only (per sheet key), so a
 * driver who reloads the page in the yard keeps his place. Nothing is sent to the server.
 */
const listeners = new Set<() => void>();
function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => void listeners.delete(callback);
}
function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false; // storage blocked: the tick just isn't remembered
  }
}

export function PickCheck({ storageKey, className, children }: { storageKey: string; className?: string; children: ReactNode }) {
  const done = useSyncExternalStore(subscribe, () => read(storageKey), () => false);
  function toggle(next: boolean) {
    try {
      if (next) window.localStorage.setItem(storageKey, "1");
      else window.localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    listeners.forEach((callback) => callback());
  }
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 px-4 py-2.5 print:min-h-0 print:py-1.5", done && "text-muted-foreground", className)}>
      <input
        type="checkbox"
        checked={done}
        onChange={(event) => toggle(event.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-[var(--brand)]"
      />
      <span className={cn("min-w-0 flex-1", done && "line-through decoration-muted-foreground/60")}>{children}</span>
    </label>
  );
}
