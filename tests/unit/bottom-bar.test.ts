import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/components/app-shell/nav-links.tsx"), "utf8");

describe("bottom bar", () => {
  it("shows the name of the open tab only, in a pill that grows without animating under reduced motion", () => {
    expect(source).toContain('active ? "flex-[3]" : "flex-1"');
    expect(source).toContain("transition-[flex-grow]");
    expect(source).toContain("motion-reduce:transition-none");
    expect(source).toContain("var(--ease-out)");
    // The other tabs are icons, so their name must stay as the accessible name.
    expect(source).toContain("aria-label={count > 0");
    expect(source).toContain('aria-label={t("more")}');
  });

  it("scrolls to the top when the current tab is tapped, and keeps the frame layer name", () => {
    expect(source).toContain("window.scrollTo");
    expect(source).toContain("if (pathname !== href) return;");
    expect(source).toContain("[view-transition-name:app-bottom-nav]");
  });
});
