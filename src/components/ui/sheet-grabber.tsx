"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const CLOSE_DISTANCE = 96; // px dragged down that always closes
const FLICK_DISTANCE = 40; // a shorter drag closes when it is quick
const FLICK_SPEED = 0.6; // px per ms

/**
 * The grabber of a bottom sheet on a phone: a short bar at the top that can be dragged down to dismiss the sheet
 * (Apple's sheets.md: "Include a grabber in a resizable sheet", "Support swiping to dismiss a sheet"). It only shows
 * below `sm`; larger screens keep the dialog as it was. Closing is also always possible with the close button and
 * Escape, so the gesture is never the only way out. Works on the native `<dialog>` it is given.
 */
export function SheetGrabber({ dialogRef }: { dialogRef: RefObject<HTMLDialogElement | null> }) {
  const start = useRef<{ y: number; t: number } | null>(null);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => clearTimers, []);

  // Back to rest. The inline transition lives only as long as the snap-back: left in place it would override the
  // stylesheet's transition and switch off the dialog's own open and close animation.
  const reset = (animate: boolean) => {
    const el = dialogRef.current;
    if (!el) return;
    const snap = animate && !reduced();
    el.style.transition = snap ? "transform 150ms ease-out" : "";
    el.style.transform = "";
    if (snap) later(() => {
      el.style.transition = "";
    }, 170);
  };

  return (
    <div
      aria-hidden
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { y: event.clientY, t: performance.now() };
        clearTimers();
        const el = dialogRef.current;
        if (el) el.style.transition = "none";
      }}
      onPointerMove={(event) => {
        if (!start.current || !dialogRef.current) return;
        const dy = Math.max(0, event.clientY - start.current.y);
        dialogRef.current.style.transform = `translateY(${dy}px)`;
      }}
      onPointerUp={(event) => {
        const from = start.current;
        start.current = null;
        if (!from) return;
        const dy = Math.max(0, event.clientY - from.y);
        const speed = dy / Math.max(1, performance.now() - from.t);
        if (dy > CLOSE_DISTANCE || (dy > FLICK_DISTANCE && speed > FLICK_SPEED)) {
          const el = dialogRef.current;
          const finish = () => {
            dialogRef.current?.close();
            requestAnimationFrame(() => reset(false));
          };
          // Carry on down off the screen, then close: the sheet leaves the way the finger took it.
          if (el && !reduced()) {
            el.style.transition = "transform 160ms ease-out";
            el.style.transform = "translateY(100%)";
            later(finish, 160);
          } else finish();
        } else reset(true);
      }}
      onPointerCancel={() => {
        start.current = null;
        reset(true);
      }}
      className="flex touch-none justify-center py-2.5 sm:hidden"
    >
      <span className="h-1.5 w-10 rounded-full bg-border" />
    </div>
  );
}
