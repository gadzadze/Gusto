import { describe, expect, it } from "vitest";
import { fieldErrorsFrom } from "@/lib/validation/form-errors";
import { supplierRequestSchema } from "@/lib/validation/supplier-request";

const valid = {
  businessName: "[TEST] Winiveria",
  legalId: "204 512-345",
  contactName: "Giorgi",
  phone: "599 00 00 00",
  email: "  Orders@Winiveria.GE ",
  city: "თბილისი",
  note: "",
};

describe("supplierRequestSchema", () => {
  it("normalizes the ID, phone and email, and drops an empty note", () => {
    expect(supplierRequestSchema.parse(valid)).toMatchObject({
      legalId: "204512345",
      phone: "+995599000000",
      email: "orders@winiveria.ge",
      note: undefined,
    });
  });

  it("reports i18n keys per field", () => {
    const result = supplierRequestSchema.safeParse({ ...valid, legalId: "12345", phone: "1", email: "nope", businessName: " " });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFrom(result.error)).toEqual({
      businessName: "required",
      legalId: "invalid_legal_id",
      phone: "invalid_phone",
      email: "invalid_email",
    });
  });

  it("strips fields the visitor must not control", () => {
    expect(supplierRequestSchema.parse({ ...valid, status: "approved" })).not.toHaveProperty("status");
  });
});
