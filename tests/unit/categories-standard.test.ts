import { describe, expect, it } from "vitest";
import { buildCategoryLookup, normalizeCategoryKey, STANDARD_CATEGORIES, standardCategoryFor } from "@/lib/catalog/categories-standard";
import { PRODUCT_UNITS, parseUnit, unitAliasTable } from "@/lib/catalog/units";

describe("category matching", () => {
  it("normalises capitals, spaces, quotes and the words 'and'", () => {
    expect(normalizeCategoryKey("  რძის   პროდუქტები ")).toBe("რძის პროდუქტები");
    expect(normalizeCategoryKey("Fruit & Vegetables")).toBe(normalizeCategoryKey("fruit, vegetables"));
    expect(normalizeCategoryKey("ბოსტნეული და ხილი")).toBe(normalizeCategoryKey("ბოსტნეული / ხილი"));
    expect(normalizeCategoryKey("“სასმელები”")).toBe("სასმელები");
  });

  it("recognises standard names and their aliases, and nothing else", () => {
    expect(standardCategoryFor("Drinks")).toBe("სასმელები");
    expect(standardCategoryFor("DAIRY")).toBe("რძის პროდუქტები");
    expect(standardCategoryFor("რძის ნაწარმი")).toBe("რძის პროდუქტები");
    expect(standardCategoryFor("ბოსტნეული")).toBe("ბოსტნეული და ხილი");
    expect(standardCategoryFor("ზეთი")).toBe("ზეთი და ცხიმები");
    expect(standardCategoryFor("Toys")).toBeNull();
  });

  it("has no standard name that is also another category's alias", () => {
    const names = new Set(STANDARD_CATEGORIES.map((c) => normalizeCategoryKey(c.name)));
    for (const c of STANDARD_CATEGORIES) {
      for (const alias of c.aliases) {
        const key = normalizeCategoryKey(alias);
        if (names.has(key)) expect(c.name, `${alias} duplicates a standard name`).toBe(STANDARD_CATEGORIES.find((s) => normalizeCategoryKey(s.name) === key)!.name);
      }
    }
  });

  it("lets a file's spelling reach the category Gusto has: own name first, then aliases of the standard ones it has", () => {
    const lookup = buildCategoryLookup([
      { id: "A", name: "რძის პროდუქტები" },
      { id: "B", name: "My own group" },
    ]);
    expect(lookup.get(normalizeCategoryKey("dairy"))).toBe("A");
    expect(lookup.get(normalizeCategoryKey("რძე"))).toBe("A");
    expect(lookup.get(normalizeCategoryKey("my  OWN group"))).toBe("B");
    // Aliases of standard categories Gusto does not have do not match anything.
    expect(lookup.get(normalizeCategoryKey("wine"))).toBeUndefined();
  });
});

describe("unit matching", () => {
  it("accepts the common spellings of every unit, in Georgian, English and Russian", () => {
    const cases: [string, string][] = [
      ["Pcs.", "piece"], ["ც.", "piece"], ["Piece(s)", "piece"], ["шт", "piece"],
      ["კგ", "kg"], ["Kg.", "kg"], ["кг", "kg"],
      ["გრ", "g"], ["ლ", "l"], ["Ltr", "l"], ["მლ", "ml"],
      ["Ctn", "box"], ["ყუთი", "box"], ["Pkg", "pack"], ["შეკვრა", "pack"], ["კოლოფი", "case"],
      ["Btl.", "bottle"], ["ბოთლი", "bottle"], ["ქილა", "jar"], ["can", "jar"],
      ["პარკი", "bag"], ["ტომარა", "sack"], ["კასრი", "keg"], ["Barrel", "keg"],
      ["პალეტა", "pallet"], ["კონა", "bunch"], ["რულონი", "roll"], ["ვედრო", "bucket"],
    ];
    for (const [text, unit] of cases) expect(parseUnit(text), text).toBe(unit);
    expect(parseUnit("parsec")).toBeNull();
    expect(parseUnit("")).toBeNull();
  });

  it("gives every unit at least one alias", () => {
    const table = unitAliasTable();
    for (const unit of PRODUCT_UNITS) expect(table[unit].length, unit).toBeGreaterThan(0);
  });
});
