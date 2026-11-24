import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

describe("motion rules", () => {
  it("every data-motion value used by a component has a style rule", () => {
    const used = new Set<string>();
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      for (const match of readFileSync(file, "utf8").matchAll(/data-motion="([a-z]+)"/g)) used.add(match[1]);
    }
    expect([...used].sort()).toEqual(["menu", "sheet", "side", "top"]);
    for (const value of used) expect(css, `data-motion="${value}"`).toContain(`[data-motion="${value}"]`);
  });

  it("switches every added animation and transition off under reduced motion", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n  dialog,"));
    for (const selector of ["dialog,", "dialog::backdrop", '[popover][data-motion="menu"]', "[data-cart-line]"]) {
      expect(reduced).toContain(selector);
    }
    for (const klass of [".animate-rise-in", ".animate-pop", ".animate-toast-in", ".animate-toast-out"]) {
      expect(reduced).toContain(klass);
    }
  });

  it("keeps the app frame out of page transitions", () => {
    for (const name of ["app-sidebar", "app-header", "app-bottom-nav"]) {
      expect(css).toContain(`::view-transition-group(${name})`);
    }
  });

  it("uses the shared easing curve for everything in the block", () => {
    const block = css.slice(css.indexOf("/* Everything comes from somewhere"), css.indexOf("/* Phone type scale"));
    // `var(--ease-out)` is fine; a bare keyword curve is not.
    expect(block.match(/(?<![-\w])ease(-in|-out|-in-out)?\b/g) ?? []).toEqual([]);
  });

  it("only animates a dialog out where `overlay` is supported", () => {
    const block = css.slice(css.indexOf("/* Everything comes from somewhere"), css.indexOf("/* Phone type scale"));
    // Every `overlay`/`display` transition sits inside an @supports (overlay: auto) block.
    const outside = block.replace(/@supports \(overlay: auto\) \{[\s\S]*?\n\}\n/g, "");
    expect(outside).not.toMatch(/\boverlay\b[^;]*allow-discrete/);
    expect(outside).not.toMatch(/\bdisplay \d+ms allow-discrete/);
    expect(block).toContain("@supports (overlay: auto)");
  });

  it("keeps every motion within 250 ms", () => {
    const block = css.slice(css.indexOf("/* Everything comes from somewhere"), css.indexOf("/* Phone type scale"));
    const slow = [...block.matchAll(/(\d+)ms/g)].map((m) => Number(m[1])).filter((ms) => ms > 250);
    // The new-order highlight fades a colour for 1.8 s; it moves nothing.
    expect(slow).toEqual([1800]);
  });

  it("gives rounded surfaces squircle corners only where the browser supports them", () => {
    const start = css.indexOf("@supports (corner-shape: squircle)");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("\n}\n", start));
    for (const selector of [".rounded-lg", ".rounded-xl", "dialog"]) expect(block).toContain(selector);
    expect(block).not.toContain("rounded-full");
    expect(css.replace(block, "")).not.toContain("corner-shape: squircle;");
  });
});
