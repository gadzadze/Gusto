import { describe, expect, it } from "vitest";
import { isFreeMailAddress, isValidLegalId, normalizeLegalId } from "@/lib/legal-id";
import { newPasswordSchema } from "@/lib/validation/password";

describe("legal id", () => {
  it("accepts 9 and 11 digits only", () => {
    expect(isValidLegalId("123456789")).toBe(true);
    expect(isValidLegalId("12345678901")).toBe(true);
    for (const bad of ["", "12345678", "1234567890", "123456789012", "12345678a", "abc"]) {
      expect(isValidLegalId(bad)).toBe(false);
    }
  });

  it("strips spaces and dashes", () => {
    expect(normalizeLegalId(" 123-456 789 ")).toBe("123456789");
  });

  it("flags personal mailboxes but not company ones", () => {
    expect(isFreeMailAddress("someone@gmail.com")).toBe(true);
    expect(isFreeMailAddress("Someone@Mail.ru")).toBe(true);
    expect(isFreeMailAddress("orders@winiveria.ge")).toBe(false);
    expect(isFreeMailAddress(null)).toBe(false);
  });
});

describe("password schema", () => {
  it("needs 10+ characters that match", () => {
    expect(newPasswordSchema.safeParse({ password: "short", confirm: "short" }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: "long-enough-1", confirm: "different-1" }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: "long-enough-1", confirm: "long-enough-1" }).success).toBe(true);
  });
});
