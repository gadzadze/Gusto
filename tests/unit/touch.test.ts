import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("touch and text defaults", () => {
  it("removes the tap delay and the browser's own tap rectangle from controls", () => {
    expect(css).toContain("touch-action: manipulation");
    expect(css).toContain("-webkit-tap-highlight-color: transparent");
    // Pinch zoom must stay possible: never `touch-action: none` on the whole page.
    expect(css).not.toMatch(/touch-action:\s*none/);
  });

  it("balances headings", () => {
    expect(css).toMatch(/h1,\s*h2,\s*h3\s*\{\s*text-wrap:\s*balance;/);
  });
});
