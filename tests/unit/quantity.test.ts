import { describe, expect, it } from "vitest";
import { isOrderableQuantity, milliToInput, parseQuantityInput } from "@/lib/quantity";

describe("parseQuantityInput", () => {
  it.each([
    ["2", 2000],
    ["2.5", 2500],
    ["2,5", 2500],
    ["0,125", 125],
    ["0", 0],
  ])("parses %j as %i milli", (input, expected) => {
    expect(parseQuantityInput(input)).toBe(expected);
  });

  it.each([["-1"], ["1.2345"], ["x"], [""], ["1,2,3"]])("rejects %j", (input) => {
    expect(parseQuantityInput(input)).toBeNull();
  });

  it("round-trips through form text", () => {
    for (const milli of [1000, 2500, 125, 0]) {
      expect(parseQuantityInput(milliToInput(milli))).toBe(milli);
      expect(parseQuantityInput(milliToInput(milli, ","))).toBe(milli);
    }
    expect(milliToInput(500, ",")).toBe("0,5");
  });
});

describe("isOrderableQuantity", () => {
  it("accepts the minimum and steps counted from it", () => {
    expect(isOrderableQuantity(2000, 2000, 1000)).toBe(true);
    expect(isOrderableQuantity(5000, 2000, 1000)).toBe(true);
    expect(isOrderableQuantity(1500, 500, 500)).toBe(true);
  });

  it("rejects below minimum, off-step, zero step", () => {
    expect(isOrderableQuantity(1000, 2000, 1000)).toBe(false);
    expect(isOrderableQuantity(2500, 2000, 1000)).toBe(false);
    expect(isOrderableQuantity(2000, 2000, 0)).toBe(false);
  });
});
