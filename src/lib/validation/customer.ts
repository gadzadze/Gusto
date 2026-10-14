import { z } from "zod";
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
  // "" = base prices.
  priceListId: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.uuid().safeParse(v).success, { message: "required" }),
});

export type CustomerInput = z.input<typeof customerSchema>;
export type CustomerValues = z.output<typeof customerSchema>;
