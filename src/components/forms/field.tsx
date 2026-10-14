"use client";

import { useTranslations } from "next-intl";
import type * as React from "react";
import { Label } from "@/components/ui/label";
import { toValidationKey } from "@/lib/validation/form-errors";

/** Label + control + hint/error, wired for screen readers via aria-describedby. */
export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {optional ? (
          <span className="ml-1.5 font-normal text-muted-foreground">({t("onboarding.optional")})</span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {t(`validation.${toValidationKey(error)}`)}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function describedBy(id: string, error?: string, hint?: string): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}
