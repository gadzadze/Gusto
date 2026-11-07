import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, intlLocaleFor, isLocale, LOCALES } from "@/i18n/locales";
import { formatMoney } from "@/lib/money";
import { formatQuantityNumber } from "@/lib/quantity";

describe("locales", () => {
  it("ships Georgian and English, Georgian by default", () => {
    expect([...LOCALES]).toEqual(["ka", "en"]);
    expect(DEFAULT_LOCALE).toBe("ka");
  });

  it("accepts only a language it ships (the cookie is user input)", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ka")).toBe(true);
    for (const bad of ["de", "", "EN", undefined, null, 5, "en-GB"]) expect(isLocale(bad)).toBe(false);
  });

  it("formats money and quantities the way each language writes them", () => {
    // Intl puts a no-break space before the sign.
    expect(formatMoney(1250, "GEL", intlLocaleFor("ka")).replace(/\s/g, " ")).toBe("12,50 ₾");
    expect(formatMoney(1250, "GEL", intlLocaleFor("en"))).toBe("₾12.50");
    expect(formatMoney(125050, "GEL", intlLocaleFor("en"))).toBe("₾1,250.50");
    expect(formatQuantityNumber(2500, intlLocaleFor("ka"))).toBe("2,5");
    expect(formatQuantityNumber(2500, intlLocaleFor("en"))).toBe("2.5");
  });
});
