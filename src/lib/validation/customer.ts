import { z } from "zod";
import { isValidLegalId, normalizeLegalId } from "@/lib/legal-id";
import { normalizePhone } from "@/lib/phone";

export const customerSchema = z.object({
  businessName: z.string().trim().min(1, "required").max(160, "too_long"),
  contactName: z
    .string()
    .trim()
    .max(120, "too_long")
    .optional()
    .transform((v) => (v ? v : null)),
  phone: z
    .string()
    .trim()
    .min(1, "required")
    .transform((value, ctx) => {
      const normalized = normalizePhone(value);
      if (!normalized) {
        ctx.addIssue({ code: "custom", message: "invalid_phone" });
        return z.NEVER;
      }
      return normalized;
    }),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.email().safeParse(v).success, { message: "invalid_email" }),
  // Optional identification code (9 or 11 digits). Lets 202 offer a connection request when the
  // business is already here, and match this invitation when it joins later.
  legalId: z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (!value) return null;
      const normalized = normalizeLegalId(value);
      if (!isValidLegalId(normalized)) {
        ctx.addIssue({ code: "custom", message: "invalid_legal_id" });
        return z.NEVER;
      }
      return normalized;
    }),
  // "" = base prices.
  priceListId: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.uuid().safeParse(v).success, { message: "required" }),
});

export type CustomerInput = z.input<typeof customerSchema>;
export type CustomerValues = z.output<typeof customerSchema>;
