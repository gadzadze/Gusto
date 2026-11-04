import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractSheetImages } from "@/lib/catalog/sheet-images";

describe("extractSheetImages", () => {
  it("finds the picture in each product row of an xlsx", () => {
    const file = readFileSync("tests/unit/fixtures/gusto-products-with-photos.xlsx");
    const { byRow, skipped } = extractSheetImages(new Uint8Array(file));
    // Header is sheet row 0; the six products are rows 1-6.
    expect([...byRow.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(skipped).toBe(0);
    const first = byRow.get(1)!;
    expect(first.mime).toBe("image/png");
    expect([...first.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("returns nothing for a file that is not an xlsx", () => {
    expect(extractSheetImages(new Uint8Array([1, 2, 3])).byRow.size).toBe(0);
  });
});
