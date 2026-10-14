import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod";
import { fieldErrorsFrom } from "./form-errors";

/**
 * React Hook Form resolver for a shared Zod schema. The form keeps raw
 * (string) values; the Server Action parses again with the same schema.
 * Error messages are `validation.*` keys, translated by <Field>.
 */
export function zodFormResolver<T extends FieldValues>(schema: z.ZodType): Resolver<T> {
  return async (values) => {
    const parsed = schema.safeParse(values);
    if (parsed.success) return { values, errors: {} };
    const errors = Object.fromEntries(
      Object.entries(fieldErrorsFrom(parsed.error)).map(([field, key]) => [
        field,
        { type: "validation", message: key },
      ]),
    );
    return { values: {}, errors: errors as FieldErrors<T> };
  };
}
