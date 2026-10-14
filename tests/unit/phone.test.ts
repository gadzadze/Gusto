import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/phone";

describe("normalizePhone", () => {
  it("normalizes Georgian mobile numbers in common formats to E.164", () => {
    expect(normalizePhone("555 12 34 56")).toBe("+995555123456");
    expect(normalizePhone("+995 555 123 456")).toBe("+995555123456");
    expect(normalizePhone("995555123456")).toBe("+995555123456");
  });

  it("accepts Tbilisi landlines", () => {
    expect(normalizePhone("032 2 12 34 56")).toBe("+995322123456");
  });

  it("keeps foreign numbers with a country code", () => {
    expect(normalizePhone("+49 30 12345678")).toBe("+493012345678");
  });

  it("rejects garbage and too-short numbers", () => {
    expect(normalizePhone("hello")).toBeNull();
    expect(normalizePhone("555")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("formatPhone", () => {
  it("formats E.164 for display and leaves junk alone", async () => {
    const { formatPhone } = await import("@/lib/phone");
    expect(formatPhone("+995599000000")).toBe("+995 599 00 00 00");
    expect(formatPhone("not a phone")).toBe("not a phone");
  });
});
