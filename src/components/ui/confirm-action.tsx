"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * A button for an action that is hard to undo. The first press opens a short question right where the button was,
 * with the action named on the confirming button and a Cancel next to it (the same two-step pattern as deleting a
 * product), instead of a browser pop-up. Escape closes it; focus lands on Cancel, so a second Enter cannot confirm.
 */
export function ConfirmAction({
  label,
  message,
  confirmLabel,
  onConfirm,
  variant = "outline",
  size = "sm",
  disabled,
  ariaLabel,
  icon,
}: {
  /** The button's own text. */
  label: string;
  /** The question: what will happen, in a full sentence. */
  message: string;
  /** Text of the confirming button (usually the same verb as the label). */
  confirmLabel: string;
  onConfirm: () => void;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  disabled?: boolean;
  ariaLabel?: string;
  icon?: React.ReactNode;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancel.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <Button type="button" variant={variant} size={size} disabled={disabled} aria-label={ariaLabel} onClick={() => setOpen(true)}>
        {icon}
        {label}
      </Button>
    );
  }
  return (
    <div
      role="group"
      aria-label={message}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
        }
      }}
      className="animate-rise-in w-full basis-full space-y-2 rounded-lg border border-border bg-muted p-3"
    >
      <p className="text-sm">{message}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            setOpen(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
        <Button ref={cancel} type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
