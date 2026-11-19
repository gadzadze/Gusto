import { describe, expect, it } from "vitest";
import { canonicalProductQuery, canonicalQuery, cleanFilterName } from "@/lib/saved-filters";

const CAT = "3f2c1b7a-8d4e-4c1a-9b6f-0a1b2c3d4e5f";

describe("saved filter queries", () => {
  it("builds one canonical string from valid filters only, in a fixed order", () => {
    expect(canonicalProductQuery({ stock: "low", status: "active", category: CAT.toUpperCase(), q: "  kveli " })).toBe(
      `q=kveli&category=${CAT}&status=active&stock=low`,
    );
    expect(canonicalProductQuery({})).toBe("");
    expect(canonicalProductQuery({ status: "all", stock: "", category: "", q: "" })).toBe("");
  });

  it("drops anything that is not a known filter or a valid value", () => {
    expect(canonicalProductQuery({ category: "not-a-uuid", status: "weird", stock: "high" })).toBe("");
    expect(canonicalQuery("products", `page=3&evil=1&q=a&status=inactive&redirect=https://x.test`)).toBe("q=a&status=inactive");
    expect(canonicalProductQuery({ q: "x".repeat(500) }).length).toBeLessThan(110);
  });

  it("is stable when read back", () => {
    const q = canonicalProductQuery({ q: "ყველი & ზეთი", status: "inactive" });
    expect(canonicalQuery("products", q)).toBe(q);
  });

  it("cleans view names", () => {
    expect(cleanFilterName("  Low   stock \n cheese ")).toBe("Low stock cheese");
    expect(cleanFilterName("a".repeat(100)).length).toBe(40);
    expect(cleanFilterName("   ")).toBe("");
  });
});
