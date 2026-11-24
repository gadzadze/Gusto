import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" || name === "loading.tsx" ? [path] : [];
  });
}

/*
 * Moving between dashboard pages keeps the old page on screen until the next one is ready, with no skeleton in between.
 * That only works while the page has no Suspense boundary of its own: the area layout's boundary is already revealed, so React
 * holds the old UI instead of committing a new fallback. A page-level <Suspense> (or a loading.tsx) brings the skeleton back on
 * every navigation, which looks like a bug. The layout shows the shell skeleton on a hard load.
 */
describe("dashboard pages", () => {
  for (const area of ["buyer", "supplier", "admin"]) {
    it(`${area} pages have no Suspense boundary or loading.tsx of their own`, () => {
      const offenders = pages(join(process.cwd(), "src/app", area)).filter(
        (file) => file.endsWith("loading.tsx") || readFileSync(file, "utf8").includes("<Suspense"),
      );
      expect(offenders).toEqual([]);
    });
  }
});
