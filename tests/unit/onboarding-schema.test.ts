import { describe, expect, it } from "vitest";
import { fieldErrorsFrom } from "@/lib/validation/form-errors";
import { onboardingSchema } from "@/lib/validation/onboarding";

const validBuyer = {
  kind: "buyer",
  businessName: "[TEST] Café",
  businessType: "cafe",
  contactName: "Nino",
  phone: "555 12 34 56",
  city: "თბილისი",
  addressLine: "Rustaveli Ave 1",
  deliveryInstructions: "",
};

const validSupplier = {
  kind: "supplier",
  businessName: "[TEST] Distribution",
  legalId: "",
  contactName: "Giorgi",
  phone: "+995 599 00 00 00",
  city: "თბილისი",
  deliveryArea: "Tbilisi",
};

describe("onboardingSchema", () => {
  it("accepts a valid buyer and normalizes values", () => {
    const parsed = onboardingSchema.parse(validBuyer);
    expect(parsed).toMatchObject({ kind: "buyer", phone: "+995555123456", businessType: "cafe" });
    expect(parsed.kind === "buyer" && parsed.deliveryInstructions).toBeUndefined();
  });

  it("accepts a valid supplier with or without an ID number", () => {
    expect(onboardingSchema.parse(validSupplier).kind).toBe("supplier");
    expect(onboardingSchema.parse({ ...validSupplier, legalId: "123456789" })).toMatchObject({
      legalId: "123456789",
    });
    expect(onboardingSchema.parse({ ...validSupplier, legalId: "12345678901" })).toMatchObject({
      legalId: "12345678901",
    });
  });

  it("strips fields the client must not control", () => {
    const parsed = onboardingSchema.parse({
      ...validSupplier,
      status: "active",
      isPlatformAdmin: true,
      type: "buyer",
      role: "owner",
    });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("isPlatformAdmin");
    expect(parsed).not.toHaveProperty("type");
    expect(parsed).not.toHaveProperty("role");
  });

  it("rejects kinds other than buyer and supplier", () => {
    for (const kind of ["admin", "platform_admin", "", undefined]) {
      expect(onboardingSchema.safeParse({ ...validBuyer, kind }).success).toBe(false);
    }
  });

  it("reports i18n keys per field", () => {
    const result = onboardingSchema.safeParse({
      ...validBuyer,
      businessName: "  ",
      phone: "123",
      businessType: "nightclub",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFrom(result.error)).toEqual({
      businessName: "required",
      phone: "invalid_phone",
      businessType: "required",
    });
  });

  it("rejects malformed supplier ID numbers", () => {
    const result = onboardingSchema.safeParse({ ...validSupplier, legalId: "12345" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFrom(result.error)).toEqual({ legalId: "invalid_legal_id" });
  });
});
