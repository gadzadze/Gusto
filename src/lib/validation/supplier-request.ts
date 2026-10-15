import { z } from "zod";
import { isValidLegalId, normalizeLegalId } from "@/lib/legal-id";
import { normalizePhone } from "@/lib/phone";

// The public "onboard me" form. Messages are i18n keys under `validation.*`.
const text = (max: number) => z.string().trim().min(1, "required").max(max, "too_long");

export const supplierRequestSchema = z.object({
  businessName: text(160),
  legalId: z
    .string()
    .transform(normalizeLegalId)
    .pipe(z.string().min(1, "required"))
    .refine(isValidLegalId, { message: "invalid_legal_id" }),
  contactName: text(120),
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
    .min(1, "required")
    .max(254, "too_long")
    .pipe(z.email({ message: "invalid_email" })),
  city: text(80),
  note: z
    .string()
    .trim()
    .max(500, "too_long")
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type SupplierRequestInput = z.input<typeof supplierRequestSchema>;
export type SupplierRequestValues = z.output<typeof supplierRequestSchema>;
