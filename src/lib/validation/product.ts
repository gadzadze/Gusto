import { z } from "zod";
import { PRODUCT_UNITS } from "@/lib/catalog/units";
import { parseMoneyInput } from "@/lib/money";
import { parseQuantityInput } from "@/lib/quantity";

// Shared by the product form (client) and the Server Actions / import.
// Numeric fields arrive as text and leave as integers (minor units,
// milli-units, basis points). Messages are `validation.*` i18n keys.

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "too_long")
    .optional()
    .transform((v) => (v ? v : null));

export const moneyField = z
  .string()
  .trim()
  .min(1, "required")
  .transform((value, ctx) => {
    const minor = parseMoneyInput(value);
    if (minor === null) {
      ctx.addIssue({ code: "custom", message: "invalid_price" });
      return z.NEVER;
    }
    return minor;
  });

export const positiveQuantityField = z
  .string()
  .trim()
  .min(1, "required")
  .transform((value, ctx) => {
    const milli = parseQuantityInput(value);
    if (milli === null || milli === 0) {
      ctx.addIssue({ code: "custom", message: "invalid_quantity" });
      return z.NEVER;
    }
    return milli;
  });

/** VAT as a percentage ("18", "0", "5.5") → basis points (1800, 0, 550). */
export const vatRateField = z
  .string()
  .trim()
  .min(1, "required")
  .transform((value, ctx) => {
    const normalized = value.replace(",", ".").replace(/%$/, "").trim();
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalized)) {
      ctx.addIssue({ code: "custom", message: "invalid_vat" });
      return z.NEVER;
    }
    const [whole, fraction = ""] = normalized.split(".");
    const bp = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (bp > 10_000) {
      ctx.addIssue({ code: "custom", message: "invalid_vat" });
      return z.NEVER;
    }
    return bp;
  });

export const productSchema = z
  .object({
    name: z.string().trim().min(1, "required").max(200, "too_long"),
    description: optionalText(2000),
    brand: optionalText(100),
    sku: optionalText(64),
    categoryId: z.uuid("required"),
    unit: z.enum(PRODUCT_UNITS, { message: "required" }),
    packDescription: optionalText(100),
    basePrice: moneyField,
    vatRate: vatRateField,
    minQty: positiveQuantityField,
    qtyStep: positiveQuantityField,
  });

export type ProductInput = z.input<typeof productSchema>;
export type ProductValues = z.output<typeof productSchema>;

/** Defaults for a new product form. 18% is only a pre-filled suggestion. */
export const NEW_PRODUCT_DEFAULTS: ProductInput = {
  name: "",
  description: "",
  brand: "",
  sku: "",
  categoryId: "",
  unit: "piece",
  packDescription: "",
  basePrice: "",
  vatRate: "18",
  minQty: "1",
  qtyStep: "1",
};
