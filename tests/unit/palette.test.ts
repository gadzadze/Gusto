import { describe, expect, it } from "vitest";
import { orderNumberFrom } from "@/lib/palette";

describe("palette order numbers", () => {
  it("reads GST numbers in the ways people type them", () => {
    expect(orderNumberFrom("GST-1004")).toBe(1004);
    expect(orderNumberFrom("gst1004")).toBe(1004);
    expect(orderNumberFrom(" gst 1004 ")).toBe(1004);
    expect(orderNumberFrom("1004")).toBe(1004);
  });
  it("ignores everything else", () => {
    expect(orderNumberFrom("100")).toBeNull();
    expect(orderNumberFrom("cheese")).toBeNull();
    expect(orderNumberFrom("GST-10x4")).toBeNull();
    expect(orderNumberFrom("12345678901")).toBeNull();
  });
});
