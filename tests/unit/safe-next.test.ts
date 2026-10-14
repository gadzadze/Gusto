import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-next";

describe("safeNextPath", () => {
  it("accepts same-site paths", () => {
    expect(safeNextPath("/supplier")).toBe("/supplier");
    expect(safeNextPath("/invite/abc?x=1")).toBe("/invite/abc?x=1");
  });

  it.each([
    ["https://evil.example"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["supplier"],
    [""],
    ["/a\nb"],
    [`/${"a".repeat(600)}`],
    [undefined],
    [42],
  ])("rejects %j", (input) => {
    expect(safeNextPath(input)).toBeNull();
  });
});
