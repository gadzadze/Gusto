import { z } from "zod";
import { isValidLegalId, normalizeLegalId } from "@/lib/legal-id";
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
  })
  .refine((v) => v.phone !== null || v.email !== null, { message: "contact_required", path: ["phone"] });

export type SupplierInviteInput = z.input<typeof supplierInviteSchema>;
export type SupplierInviteValues = z.output<typeof supplierInviteSchema>;
