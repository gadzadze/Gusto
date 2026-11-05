import { z } from "zod";
import { normalizePhone } from "@/lib/phone";

// A buyer inviting a supplier it already works with. The phone or the email is
// needed so the buyer has a way to send the link; messages are `validation.*` keys.
export const supplierInviteSchema = z
  .object({
    supplierName: z.string().trim().min(1, "required").max(160, "too_long"),
    phone: z
      .string()
      .trim()
      .optional()
      .transform((value, ctx) => {
        if (!value) return null;
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
  })
  .refine((v) => v.phone !== null || v.email !== null, { message: "contact_required", path: ["phone"] });

export type SupplierInviteInput = z.input<typeof supplierInviteSchema>;
export type SupplierInviteValues = z.output<typeof supplierInviteSchema>;
