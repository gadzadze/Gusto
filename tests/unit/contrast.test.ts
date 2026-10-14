import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// WCAG 2.x contrast of the design tokens, read straight from globals.css so
// the test fails if someone changes a colour without checking it.

const css = readFileSync("src/app/globals.css", "utf8");

function block(source: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const m of source.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[m[1]] = m[2].toLowerCase();
  return vars;
}

const rootMatch = css.match(/:root\s*\{([\s\S]*?)\n\}/);
const darkMatch = css.match(/prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n\s*\}\s*\n\}/);
const light = block(rootMatch![1]);
const dark = { ...light, ...block(darkMatch![1]) };

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground token, background token, minimum ratio, what it is]
const TEXT = 4.5;
const UI = 3; // focus rings, icons, borders that carry meaning
const PAIRS: [string, string, number, string][] = [
  ["ink", "surface", TEXT, "body text"],
  ["ink", "surface-2", TEXT, "text on cards and sidebar"],
  ["muted-text", "surface", TEXT, "secondary text"],
  ["muted-text", "surface-2", TEXT, "secondary text on cards"],
  ["muted-text", "brand-soft", TEXT, "secondary text on selected rows"],
  ["brand", "surface", TEXT, "links, active nav"],
  ["brand", "surface-2", TEXT, "links on cards"],
  ["brand", "brand-soft", TEXT, "active pill (brand text on brand-soft)"],
  ["primary-foreground", "ink", TEXT, "primary button label"],
  ["brand-foreground", "brand", TEXT, "text on brand fill (unread count)"],
  ["danger", "surface", TEXT, "error text"],
  ["status-amber-fg", "status-amber-bg", TEXT, "pending badge"],
  ["status-blue-fg", "status-blue-bg", TEXT, "confirmed badge"],
  ["status-green-fg", "status-green-bg", TEXT, "delivered badge"],
  ["status-gray-fg", "status-gray-bg", TEXT, "rejected/cancelled badge"],
  ["brand", "surface", UI, "focus ring against the page"],
  ["brand", "surface-2", UI, "focus ring against cards"],
];

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("contrast, %s theme (WCAG AA)", (_name, tokens) => {
  it.each(PAIRS)("%s on %s ≥ %f (%s)", (fg, bg, min) => {
    expect(tokens[fg], `token --${fg}`).toBeDefined();
    expect(tokens[bg], `token --${bg}`).toBeDefined();
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min);
  });
});
