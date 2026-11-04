import { describe, expect, it } from "vitest";
import { generateSku } from "@/lib/catalog/auto-sku";
import { guessCategoryFromName } from "@/lib/catalog/category-guess";
import { buildCategoryLookup, normalizeCategoryKey, STANDARD_CATEGORIES } from "@/lib/catalog/categories-standard";
import { guessMapping, importOptionsSchema, missingRequiredFields, parseImportRow } from "@/lib/catalog/import";
import { cleanAmountText, parseMoneyInput } from "@/lib/money";

const ids = new Map(STANDARD_CATEGORIES.map((c, i) => [c.name, `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`]));
const lookup = buildCategoryLookup([...ids].map(([name, id]) => ({ id, name })));
const idOf = (name: string) => ids.get(name) as string;

describe("guessCategoryFromName", () => {
  it("files common HoReCa products under the standard categories", () => {
    const cases: [string, string][] = [
      ["პრეზიდენტი კარაქი 82% 400 გ.", "რძის პროდუქტები"],
      ["რძე 3.2%, 1000 მლ, \"Milkavita\"", "რძის პროდუქტები"],
      ["ყველი პარმეზანი \" ძუგა \"", "ყველი"],
      ["პრეზიდენტი კრემ ყველი პროფესიონალი 65% 2200 გ.", "ყველი"],
      ["Nordic-კრევეტები გარჩეული ვანამეი HLSL 16/20 1კგ (10)", "თევზი და ზღვის პროდუქტები"],
      ["ქათმის უძვლო ბარკალი", "ხორცი და ფრინველი"],
      ["გაყინული კარტოფილი 10X10 პრემიუმი BRAVI", "გაყინული პროდუქტები"],
      ["მზეს. ზეთი ბარაქა (ფრიტურის) 5 ლ", "ზეთი და ცხიმები"],
      ["AroyD-ქოქოსის რძე 400მლ (24)", "სოუსები და კონსერვები"],
      ["კეჩუპი დერბი 830გ. შაშლიჩნი", "სოუსები და კონსერვები"],
      ["ფქვილი ლა ფამილია უმაღლესი 10კგ", "ფქვილი და საცხობი ინგრედიენტები"],
      ["ბრინჯი(ბასმატი-20*1/კგ.)", "მარცვლეული და ბურღულეული"],
      ["შვეპსი ტონიკი 0.330ლ", "სასმელები"],
      ["Red wine Saperavi 0.75", "ღვინო"],
      ["ფრიტი მაკარონი სპაგეტი 500 გ", "მაკარონი"],
    ];
    for (const [name, category] of cases) expect(guessCategoryFromName(name), name).toBe(category);
  });

  it("returns null rather than guess when nothing matches", () => {
    expect(guessCategoryFromName("XJ-2000 სპეციალური")).toBeNull();
    expect(guessCategoryFromName("")).toBeNull();
  });

  it("only ever returns a standard category name", () => {
    const names = new Set(STANDARD_CATEGORIES.map((c) => c.name));
    for (const sample of ["კარაქი", "wine", "ჩაი", "ლუდი", "ნორი", "ხიზილალა", "პომიდორი", "ლიმონი"]) {
      const g = guessCategoryFromName(sample);
      if (g) expect(names.has(g)).toBe(true);
    }
  });
});

describe("generateSku", () => {
  it("is stable, ignores case and spacing, and differs between products", () => {
    expect(generateSku("ყველი სულგუნი")).toBe(generateSku("  ყველი   სულგუნი "));
    expect(generateSku("Feta")).toBe(generateSku("feta"));
    expect(generateSku("ყველი სულგუნი")).not.toBe(generateSku("ყველი იმერული"));
    expect(generateSku("x")).toMatch(/^A-[0-9A-Z]{10}$/);
  });

  it("does not collide across a few thousand names", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generateSku(`პროდუქტი ${i} ${i * 7919}`));
    expect(seen.size).toBe(5000);
  });
});

describe("cleanAmountText", () => {
  it("drops currency and settles thousands and decimal marks", () => {
    const cases: [string, number | null][] = [
      ["12,50", 1250], ["12.5", 1250], ["1 250,00", 125000], ["12,50 ₾", 1250], ["GEL 8.5", 850],
      ["1,250.50", 125050], ["1.250,50", 125050], ["8,5 ლარი", 850], ["abc", null], ["", null],
    ];
    for (const [text, minor] of cases) expect(parseMoneyInput(cleanAmountText(text)), text).toBe(minor);
  });
});

describe("import options", () => {
  const headers = ["დასახელება", "ერთეული", "ფასი"];
  const map = guessMapping(headers);
  const row = (name: string, unit = "კგ", price = "8,5", extra: string[] = []) => [name, unit, price, ...extra];

  it("recognises more header spellings", () => {
    expect(guessMapping(["Product name", "Group", "Barcode", "Price (GEL)", "UoM"]).sku).toBe("Barcode");
    expect(guessMapping(["პროდუქტის დასახელება", "ჯგუფი", "ფასი"]).category).toBe("ჯგუფი");
    expect(guessMapping(["Наименование", "Цена", "Ед"]).name).toBe("Наименование");
  });

  it("without options a missing category column is an error, with a fallback it is not", () => {
    expect(missingRequiredFields(map)).toEqual(["category"]);
    expect(missingRequiredFields(map, { guessCategory: true })).toEqual([]);
    expect(missingRequiredFields(map, { defaultCategoryId: "x" })).toEqual([]);
    expect(missingRequiredFields({ name: "a", price: "b", category: "c" }, {})).toEqual(["unit"]);
    expect(missingRequiredFields({ name: "a", price: "b", category: "c" }, { defaultUnit: "kg" })).toEqual([]);
  });

  it("guesses the category, marks it as guessed, and reports what it cannot guess", () => {
    const ok = parseImportRow(row("ქათმის უძვლო ბარკალი"), headers, map, lookup, { guessCategory: true });
    expect(ok).toMatchObject({ ok: true, meta: { categoryId: idOf("ხორცი და ფრინველი"), categorySource: "guess", skuGenerated: false } });
    const bad = parseImportRow(row("QZ-77"), headers, map, lookup, { guessCategory: true });
    expect(bad).toMatchObject({ ok: false, errors: [{ field: "category", key: "category_not_guessed" }] });
  });

  it("uses the chosen category only for empty cells, never over a written one", () => {
    const withCol = { ...map, category: "კატეგორია" };
    const h = [...headers, "კატეგორია"];
    const chosen = idOf("სურსათი");
    const empty = parseImportRow(row("რამე", "კგ", "1", [""]), h, withCol, lookup, { defaultCategoryId: chosen });
    expect(empty).toMatchObject({ ok: true, meta: { categoryId: chosen, categorySource: "default" } });
    const written = parseImportRow(row("რამე", "კგ", "1", ["Dairy"]), h, withCol, lookup, { defaultCategoryId: chosen });
    expect(written).toMatchObject({ ok: true, meta: { categoryId: idOf("რძის პროდუქტები"), categorySource: "file" } });
    const wrong = parseImportRow(row("რამე", "კგ", "1", ["Toys"]), h, withCol, lookup, { defaultCategoryId: chosen });
    expect(wrong).toMatchObject({ ok: false, errors: [{ field: "category", key: "unknown_category" }] });
  });

  it("fills an empty unit from the default but still rejects a written one it does not know", () => {
    const h = ["დასახელება", "კატეგორია", "ფასი", "ერთეული"];
    const m = guessMapping(h);
    const opts = { defaultUnit: "piece" as const };
    expect(parseImportRow(["ა", "სურსათი", "1", ""], h, m, lookup, opts)).toMatchObject({ ok: true, values: { unit: "piece" } });
    expect(parseImportRow(["ა", "სურსათი", "1", "parsec"], h, m, lookup, opts)).toMatchObject({ ok: false, errors: [{ field: "unit", key: "invalid_unit" }] });
  });

  it("generates a code only for rows without one, and cleans prices", () => {
    const h = ["დასახელება", "კოდი", "კატეგორია", "ერთეული", "ფასი"];
    const m = guessMapping(h);
    const generated = parseImportRow(["ყველი", "", "ყველი", "კგ", "12,50 ₾"], h, m, lookup, { autoSku: true });
    expect(generated).toMatchObject({ ok: true, values: { sku: generateSku("ყველი"), basePrice: 1250 }, meta: { skuGenerated: true } });
    const given = parseImportRow(["ყველი", "CH-1", "ყველი", "კგ", "1"], h, m, lookup, { autoSku: true });
    expect(given).toMatchObject({ ok: true, values: { sku: "CH-1" }, meta: { skuGenerated: false } });
    expect(parseImportRow(["ყველი", "", "ყველი", "კგ", "1"], h, m, lookup)).toMatchObject({ ok: true, values: { sku: null } });
  });

  it("validates the options coming from the browser", () => {
    expect(importOptionsSchema.parse(undefined)).toEqual({});
    expect(importOptionsSchema.safeParse({ defaultUnit: "parsec" }).success).toBe(false);
    expect(importOptionsSchema.safeParse({ defaultCategoryId: "not-a-uuid" }).success).toBe(false);
    expect(normalizeCategoryKey("x")).toBe("x");
  });
});
