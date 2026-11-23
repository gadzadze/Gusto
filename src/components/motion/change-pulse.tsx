"use client";

import { useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Plays a short pop when `value` changes after the first render (a count going up, a status becoming confirmed),
 * so a change has a visible origin instead of the text just being different. Nothing plays on first render or
 * under reduced motion (the CSS switches `animate-pop` off).
 */
export function ChangePulse({ value, className, children }: { value: string | number; className?: string; children: React.ReactNode }) {
  const [state, setState] = useState({ value, plays: 0 });
  // Derived state, set while rendering (the pattern React recommends over an effect): a new value starts a new play.
  if (state.value !== value) setState({ value, plays: state.plays + 1 });
  return (
    <span key={state.plays} className={cn("inline-flex", state.plays > 0 && "animate-pop", className)}>
      {children}
    </span>
  );
}
