import { describe, expect, it } from "vitest";
import { guessPriceMapping, parsePriceRow } from "@/lib/catalog/import";
import { whatsappLink } from "@/lib/whatsapp";
import {
  generateInviteToken,
  hashInviteToken,
  INVITE_TTL_MS,
  isInvitationUsable,
  looksLikeInviteToken,
} from "@/server/domain/customers/invite-token";
import { discountedPrice, parseDiscountPercent } from "@/server/domain/pricing/price-lists";
import { pickPrice } from "@/server/domain/pricing/resolve";

describe("pickPrice", () => {
  it("uses the override when present, otherwise the base price", () => {
    expect(pickPrice(1000, 800)).toBe(800);
    expect(pickPrice(1000, 0)).toBe(0); // a free item is an override, not "missing"
    expect(pickPrice(1000, null)).toBe(1000);
    expect(pickPrice(1000, undefined)).toBe(1000);
  });
});

describe("discounts", () => {
  it("parses percentages to basis points", () => {
    expect(parseDiscountPercent("12,5")).toBe(1250);
    expect(parseDiscountPercent("10%")).toBe(1000);
    expect(parseDiscountPercent("100")).toBe(10000);
    expect(parseDiscountPercent("100,01")).toBeNull();
    expect(parseDiscountPercent("-5")).toBeNull();
  });

  it("applies them with half-up rounding", () => {
    expect(discountedPrice(1000, 1250)).toBe(875);
    expect(discountedPrice(5, 1250)).toBe(4); // 4.375
    expect(discountedPrice(3, 5000)).toBe(2); // 1.5 → 2
    expect(discountedPrice(1000, 0)).toBe(1000);
    expect(discountedPrice(1000, 10000)).toBe(0);
  });
});

describe("invite tokens", () => {
  it("are 32 random bytes, stored only as a SHA-256 hash", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a.token).not.toBe(b.token);
    expect(looksLikeInviteToken(a.token)).toBe(true);
    expect(Buffer.from(a.token, "base64url")).toHaveLength(32);
    expect(a.hash).toBe(hashInviteToken(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.token);
  });

  it("rejects malformed tokens before any lookup", () => {
    for (const t of ["", "short", "x".repeat(44), "has space".padEnd(43, "a"), "../../etc/passwd".padEnd(43, "a")]) {
      expect(looksLikeInviteToken(t)).toBe(false);
    }
  });

  it("are usable only while unexpired, unrevoked and unaccepted", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const fresh = { expiresAt: new Date(now.getTime() + INVITE_TTL_MS), revokedAt: null, acceptedAt: null };
    expect(isInvitationUsable(fresh, now)).toBe(true);
    expect(isInvitationUsable({ ...fresh, expiresAt: now }, now)).toBe(false);
    expect(isInvitationUsable({ ...fresh, revokedAt: now }, now)).toBe(false);
    expect(isInvitationUsable({ ...fresh, acceptedAt: now }, now)).toBe(false);
    expect(INVITE_TTL_MS).toBe(14 * 24 * 3600 * 1000);
  });
});

describe("whatsappLink", () => {
  it("uses digits only and URL-encodes Georgian text", () => {
    const link = whatsappLink("+995 555 12-34-56", "გამარჯობა! https://gusto.ge/invite/abc?x=1&y=2");
    expect(link).toBe(
      `https://wa.me/995555123456?text=${encodeURIComponent("გამარჯობა! https://gusto.ge/invite/abc?x=1&y=2")}`,
    );
    expect(decodeURIComponent(new URL(link!).searchParams.get("text")!)).toContain("გამარჯობა");
  });

  it("returns null for unusable numbers", () => {
    expect(whatsappLink("123", "x")).toBeNull();
    expect(whatsappLink("", "x")).toBeNull();
  });
});

describe("price import rows", () => {
  it("guesses SKU and price columns and validates rows", () => {
    const headers = ["SKU", "დასახელება", "ფასი"];
    const mapping = guessPriceMapping(headers);
    expect(mapping).toEqual({ sku: "SKU", price: "ფასი" });
    expect(parsePriceRow(["A-1", "x", "4,20"], headers, mapping)).toEqual({ ok: true, sku: "A-1", priceMinor: 420 });
    expect(parsePriceRow(["", "x", "abc"], headers, mapping)).toEqual({
      ok: false,
      sku: "",
      errors: [
        { field: "sku", key: "required" },
        { field: "price", key: "invalid_price" },
      ],
    });
  });
});
