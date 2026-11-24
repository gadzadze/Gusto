import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Selected text keeps the browser's own highlight (decided 2026-11-25): a brand-coloured highlight looks like decoration.
describe("text selection", () => {
  for (const file of ["src/app/globals.css", "src/components/landing/landing.css"]) {
    it(`${file} does not restyle ::selection`, () => {
      expect(readFileSync(join(process.cwd(), file), "utf8")).not.toContain("::selection");
    });
  }
});
