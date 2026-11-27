import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");

describe("soft glass", () => {
  it("has a pane with an edge, a soft shadow and a light blur, and no gradient", () => {
    const pane = css.match(/\.glass\s*\{([\s\S]*?)\n\s*\}/)![1];
    expect(pane).toContain("backdrop-filter");
    expect(pane).toContain("var(--glass-line)");
    expect(pane).toContain("var(--glass-shadow)");
    expect(pane).not.toMatch(/gradient/);
  });

  it("keeps the page itself pure: exactly white in light and exactly black in dark", () => {
    expect(css).toMatch(/:root\s*\{[\s\S]*?--surface:\s*#ffffff;/);
    expect(css).toMatch(/:root\[data-theme="dark"\]\s*\{[\s\S]*?--surface:\s*#000000;/);
  });

  it("falls back to a solid card where transparency is reduced or backdrop blur is missing", () => {
    expect(css).toContain("prefers-reduced-transparency: reduce");
    expect(css).toMatch(/@supports not \(\(backdrop-filter/);
  });

  it("is in the squircle list, inside the @supports block", () => {
    const block = css.match(/@supports \(corner-shape: squircle\)\s*\{([\s\S]*?)\n\}/)![1];
    expect(block).toContain(".glass");
  });
});
