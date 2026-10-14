import { describe, expect, it } from "vitest";
import { formatMoney, lineTotalMinor, minorToInput, parseMoneyInput, roundHalfUp } from "@/lib/money";

describe("parseMoneyInput", () => {
  it.each([
    ["12", 1200],
    ["12.5", 1250],
    ["12,50", 1250],
    ["0,05", 5],
    ["1 250,00", 125000],
    ["0", 0],
  ])("parses %j as %i tetri", (input, expected) => {
    expect(parseMoneyInput(input)).toBe(expected);
  });

  it.each([["-1"], ["12.345"], ["abc"], [""], ["1e3"], ["12,5,0"], ["99999999999"]])("rejects %j", (input) => {
    expect(parseMoneyInput(input)).toBeNull();
  });
});

describe("roundHalfUp", () => {
  it("rounds halves up and everything else to nearest", () => {
    expect(roundHalfUp(5n, 10n)).toBe(1n);
    expect(roundHalfUp(4n, 10n)).toBe(0n);
    expect(roundHalfUp(15n, 10n)).toBe(2n);
    expect(roundHalfUp(14n, 10n)).toBe(1n);
    expect(roundHalfUp(0n, 7n)).toBe(0n);
  });
});

describe("lineTotalMinor", () => {
  it("multiplies price by milli-quantity with half-up rounding", () => {
    expect(lineTotalMinor(1250, 3000)).toBe(3750); // 3 × 12.50
    expect(lineTotalMinor(1999, 2345)).toBe(4688); // 2.345 kg × 19.99 = 46.87655
    expect(lineTotalMinor(1, 500)).toBe(1); // 0.5 tetri rounds up
    expect(lineTotalMinor(3, 500)).toBe(2); // 1.5 rounds up
    expect(lineTotalMinor(3, 499)).toBe(1); // 1.497
  });

  it("stays exact for large values", () => {
    expect(lineTotalMinor(999_999_999, 1_000_000_000)).toBe(999_999_999_000_000);
  });
});

describe("formatting", () => {
  it("formats GEL in Georgian with two decimals", () => {
    expect(formatMoney(1250, "GEL")).toMatch(/12,50/);
    expect(formatMoney(1250, "GEL")).toMatch(/₾|GEL/);
  });

  it("round-trips minor units through form input text, with either separator", () => {
    for (const minor of [0, 5, 1250, 100000]) {
      expect(parseMoneyInput(minorToInput(minor))).toBe(minor);
      expect(parseMoneyInput(minorToInput(minor, ","))).toBe(minor);
    }
    expect(minorToInput(1850, ",")).toBe("18,50");
  });
});
