import { describe, expect, it } from "vitest";
import { buildCategoryLookup } from "@/lib/catalog/categories-standard";
import { guessMapping, parseImportRow } from "@/lib/catalog/import";

const headers = ["Name", "Barcode", "Category", "Unit", "Price"];
const mapping = guessMapping(headers);
const categories = buildCategoryLookup([{ id: "3f2c1d0e-8a4b-4c5d-9e6f-7a8b9c0d1e2f", name: "სასმელები" }]);
const row = (barcode: string, extra: Partial<Record<number, string>> = {}) => {
  const cells = ["Water", barcode, "სასმელები", "ც", "1"];
  for (const [i, v] of Object.entries(extra)) cells[Number(i)] = v as string;
  return cells;
};

describe("barcode import field", () => {
  it("maps barcode headers to the barcode field, not the code", () => {
    expect(mapping.barcode).toBe("Barcode");
    expect(mapping.sku).toBeUndefined();
  });

  it("keeps a valid barcode (spaces dropped) and uses it as the code when there is none", () => {
    const parsed = parseImportRow(row("4860 0111 6508 55"), headers, mapping, categories);
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    if (parsed.ok) {
      expect(parsed.values.barcode).toBe("48600111650855");
      expect(parsed.values.sku).toBe("48600111650855");
    }
  });

  it("rejects a barcode that is not 8-14 digits, and accepts an empty one", () => {
    const bad = parseImportRow(row("12ab"), headers, mapping, categories);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toContainEqual({ field: "barcode", key: "invalid_barcode" });
    const none = parseImportRow(row(""), headers, mapping, categories);
    expect(none.ok).toBe(true);
    if (none.ok) expect(none.values.barcode).toBeNull();
  });
});
