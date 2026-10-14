import { describe, expect, it } from "vitest";
import { buildSearchText, escapeLike, searchSkeleton } from "@/server/domain/search/translit";

describe("searchSkeleton", () => {
  it.each([
    ["ყველი", ["kveli", "qveli", "yveli"]],
    ["წყალი", ["tsqali", "wyali", "ts'q'ali", "tskali", "ckali"]],
    ["ხაჭაპური", ["khachapuri", "xachapuri"]],
    ["ღვინო", ["ghvino", "gvino"]],
    ["ფქვილი", ["pqvili", "fqvili", "pkvili"]],
  ])("maps %s and its Latin spellings to the same skeleton", (georgian, latin) => {
    const target = searchSkeleton(georgian);
    for (const spelling of latin) expect(searchSkeleton(spelling)).toBe(target);
  });

  it("is case-insensitive and collapses whitespace", () => {
    expect(searchSkeleton("  Coca  COLA ")).toBe(searchSkeleton("coca cola"));
  });

  it("handles mixed scripts", () => {
    expect(searchSkeleton("Borjomi ბორჯომი")).toBe("borjomi borjomi");
  });
});

describe("buildSearchText", () => {
  it("stores the raw lowercase text and the skeleton", () => {
    const text = buildSearchText(["ყველი სულგუნი", "Sante", null, "SKU-1"]);
    expect(text).toContain("ყველი სულგუნი");
    expect(text).toContain("kveli sulguni");
    expect(text).toContain("sku-1");
  });
});

describe("escapeLike", () => {
  it("escapes LIKE wildcards", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});
