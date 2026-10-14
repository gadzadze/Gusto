import { describe, expect, it } from "vitest";
import { guessMapping, missingRequiredFields, parseImportRow, sheetFromCells } from "@/lib/catalog/import";
import { parseUnit } from "@/lib/catalog/units";

const CAT = "11111111-1111-4111-8111-111111111111";
const categories = new Map([["რძის ნაწარმი", CAT]]);
const templateHeaders = ["სახელი", "SKU", "კატეგორია", "ერთეული", "ფასი", "დღგ %", "მინ. რაოდენობა", "ბიჯი", "შეფუთვა", "ბრენდი", "აღწერა"];

describe("sheetFromCells", () => {
  it("uses the first non-empty row as headers and drops empty rows", () => {
    const sheet = sheetFromCells([[null, ""], ["a", "b"], [1, 2.5], [null, null], [" x ", true]]);
    expect(sheet).toEqual({ headers: ["a", "b"], rows: [["1", "2.5"], ["x", "true"]] });
  });
});

describe("guessMapping", () => {
  it("recognizes the template's Georgian headers", () => {
    expect(guessMapping(templateHeaders)).toEqual({
      name: "სახელი",
      sku: "SKU",
      category: "კატეგორია",
      unit: "ერთეული",
      price: "ფასი",
      vatRate: "დღგ %",
      minQty: "მინ. რაოდენობა",
      qtyStep: "ბიჯი",
      packDescription: "შეფუთვა",
      brand: "ბრენდი",
      description: "აღწერა",
    });
  });

  it("prefers the supplier's previous mapping when the header still exists", () => {
    const mapping = guessMapping(["Item", "Cost", "Type", "UOM"], { name: "Item", price: "Cost", category: "Gone" });
    expect(mapping).toMatchObject({ name: "Item", price: "Cost", unit: "UOM" });
    expect(mapping.category).toBeUndefined();
    expect(missingRequiredFields(mapping)).toEqual(["category"]);
  });
});

describe("parseUnit", () => {
  it("accepts codes and Georgian abbreviations", () => {
    expect(parseUnit("კგ")).toBe("kg");
    expect(parseUnit("ც.")).toBe("piece");
    expect(parseUnit("Box")).toBe("box");
    expect(parseUnit("barrel")).toBeNull();
  });
});

describe("parseImportRow", () => {
  const mapping = guessMapping(templateHeaders);
  const row = (overrides: Partial<Record<string, string>> = {}) => {
    const base: Record<string, string> = {
      სახელი: "სულგუნი", SKU: "S-1", კატეგორია: "რძის ნაწარმი", ერთეული: "კგ", ფასი: "18,50",
      "დღგ %": "", "მინ. რაოდენობა": "0,5", ბიჯი: "0,5", შეფუთვა: "", ბრენდი: "", აღწერა: "",
      ...overrides,
    };
    return templateHeaders.map((h) => base[h] ?? "");
  };

  it("parses a valid row, applying defaults for empty optional cells", () => {
    const parsed = parseImportRow(row(), templateHeaders, mapping, categories);
    expect(parsed).toEqual({
      ok: true,
      values: expect.objectContaining({
        name: "სულგუნი",
        sku: "S-1",
        categoryId: CAT,
        unit: "kg",
        basePrice: 1850,
        vatRate: 1800,
        minQty: 500,
        qtyStep: 500,
        brand: null,
      }),
    });
  });

  it("matches category names case-insensitively", () => {
    const parsed = parseImportRow(row({ კატეგორია: "  რძის ნაწარმი " }), templateHeaders, mapping, categories);
    expect(parsed.ok).toBe(true);
  });

  it("reports every problem in a bad row", () => {
    const parsed = parseImportRow(
      row({ სახელი: "", კატეგორია: "Toys", ერთეული: "barrel", ფასი: "free" }),
      templateHeaders,
      mapping,
      categories,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        { field: "unit", key: "invalid_unit" },
        { field: "category", key: "unknown_category" },
        { field: "name", key: "required" },
        { field: "price", key: "invalid_price" },
      ]),
    );
  });
});
