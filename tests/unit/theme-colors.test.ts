import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// `bg-surface` and friends only exist when the theme maps the colour. A class with no colour behind it renders nothing, which once left
// the assistant panel see-through. Every `bg-*`, `text-*` and `border-*` token used in a component must be mapped in `@theme`.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const theme = css.slice(css.indexOf("@theme inline"), css.indexOf("}", css.indexOf("@theme inline")));

describe("theme colours", () => {
  it("maps the surface colours that components use", () => {
    for (const name of ["surface", "surface-2", "background", "card", "muted", "brand", "brand-soft", "tonal", "destructive"]) {
      expect(theme, `--color-${name}`).toContain(`--color-${name}:`);
    }
  });
});
