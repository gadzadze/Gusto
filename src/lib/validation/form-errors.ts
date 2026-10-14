import type { z } from "zod";

export const VALIDATION_KEYS = ["required", "too_long", "invalid_phone", "invalid_legal_id"] as const;
export type ValidationKey = (typeof VALIDATION_KEYS)[number];

/** Narrows a Zod issue message to one of our i18n keys (default: "required"). */
export function toValidationKey(message: string | undefined): ValidationKey {
  return (VALIDATION_KEYS as readonly string[]).includes(message ?? "")
    ? (message as ValidationKey)
    : "required";
}

/** Flattens Zod issues to `{ field: validationKey }`, first issue per field. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, ValidationKey> {
  const out: Record<string, ValidationKey> = {};
  for (const issue of error.issues) {
    const field = issue.path.join(".");
    if (field && !(field in out)) out[field] = toValidationKey(issue.message);
  }
  return out;
}
