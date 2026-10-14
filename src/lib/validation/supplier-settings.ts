import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import { moneyField } from "@/lib/validation/product";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "too_long")
    .optional()
    .transform((v) => (v ? v : null));

export const supplierSettingsSchema = z.object({
  contactName: z.string().trim().min(1, "required").max(120, "too_long"),
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
  // Empty means no minimum.
  minOrder: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || "0")
    .pipe(moneyField),
  pricesIncludeVat: z.boolean(),
  deliveryArea: optionalText(240),
  deliveryTerms: optionalText(1000),
  orderCutoffNote: optionalText(240),
});

export type SupplierSettingsInput = z.input<typeof supplierSettingsSchema>;
export type SupplierSettingsValues = z.output<typeof supplierSettingsSchema>;
