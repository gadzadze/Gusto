import { describe, expect, it } from "vitest";
import { parseBulkAccess } from "@/lib/access/bulk";

describe("parseBulkAccess", () => {
  it("reads email, name, legal id and role; skips blanks and a header", () => {
    const { entries, errors } = parseBulkAccess(
      "email,name,legal id,role\n\na@x.ge, შპს ა, 405123456, supplier\nb@x.ge\nc@x.ge;შპს გ;204123456;მყიდველი\n",
    );
    expect(errors).toEqual([]);
    expect(entries).toEqual([
      { line: 3, email: "a@x.ge", businessName: "შპს ა", legalId: "405123456", role: "supplier" },
      { line: 4, email: "b@x.ge", businessName: "", legalId: "", role: "" },
      { line: 5, email: "c@x.ge", businessName: "შპს გ", legalId: "204123456", role: "buyer" },
    ]);
  });

  it("reads both (in Georgian or English) as a business that buys and resells", () => {
    const { entries, errors } = parseBulkAccess("a@x.ge,შპს ა,405123456,ორივე\nb@x.ge,შპს ბ,204123456,Both");
    expect(errors).toEqual([]);
    expect(entries.map((e) => e.role)).toEqual(["both", "both"]);
  });

  it("reports a bad role, a name without an id and too many columns by line", () => {
    const { entries, errors } = parseBulkAccess("a@x.ge,N,,\nb@x.ge,,,boss\nc@x.ge,N,1,buyer,extra");
    expect(entries).toEqual([]);
    expect(errors).toEqual([
      { line: 1, key: "name_or_id" },
      { line: 2, key: "role" },
      { line: 3, key: "columns" },
    ]);
  });

  it("caps the batch", () => {
    const text = Array.from({ length: 105 }, (_, i) => `u${i}@x.ge`).join("\n");
    const r = parseBulkAccess(text);
    expect(r.entries).toHaveLength(100);
    expect(r.tooMany).toBe(true);
  });
});
