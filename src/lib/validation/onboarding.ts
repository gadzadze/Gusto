import { z } from "zod";
import { isValidLegalId, normalizeLegalId } from "@/lib/legal-id";
import { normalizePhone } from "@/lib/phone";

// Shared by the onboarding form (client) and its Server Action. Messages are
// i18n keys under `validation.*`, not user-facing text.

export const BUYER_BUSINESS_TYPES = ["restaurant", "cafe", "hotel", "retailer", "other"] as const;

const requiredText = (max: number) =>
  z.string().trim().min(1, "required").max(max, "too_long");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "too_long")
    .optional()
    .transform((v) => (v ? v : undefined));

const phone = z
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
  });

// Required for both kinds: the admin checks it before approving anyone.
const legalId = z
  .string()
  .transform(normalizeLegalId)
  .pipe(z.string().min(1, "required"))
  .refine(isValidLegalId, { message: "invalid_legal_id" });

const common = {
  legalId,
  businessName: requiredText(160),
  contactName: requiredText(120),
  phone,
  city: requiredText(80),
};

export const buyerOnboardingSchema = z.object({
  kind: z.literal("buyer"),
  ...common,
  businessType: z.enum(BUYER_BUSINESS_TYPES, { message: "required" }),
  addressLine: requiredText(240),
  deliveryInstructions: optionalText(500),
});

export const supplierOnboardingSchema = z.object({
  kind: z.literal("supplier"),
  ...common,
  deliveryArea: requiredText(240),
});

// Unknown keys (e.g. a forged `status` or `isPlatformAdmin`) are stripped:
// status and roles are decided on the server, never taken from the client.
export const onboardingSchema = z.discriminatedUnion("kind", [
  buyerOnboardingSchema,
  supplierOnboardingSchema,
]);

export type OnboardingInput = z.input<typeof onboardingSchema>;
export type OnboardingValues = z.output<typeof onboardingSchema>;
