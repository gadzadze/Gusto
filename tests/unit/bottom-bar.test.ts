import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/components/app-shell/nav-links.tsx"), "utf8");

describe("bottom bar", () => {
  it("has a sliding indicator that does not animate under reduced motion", () => {
    expect(source).toContain("data-bar-indicator");
    expect(source).toContain("motion-reduce:transition-none");
    expect(source).toContain("var(--ease-out)");
  });

  it("scrolls to the top when the current tab is tapped, and keeps the frame layer name", () => {
    expect(source).toContain("window.scrollTo");
    expect(source).toContain("if (pathname !== href) return;");
    expect(source).toContain("[view-transition-name:app-bottom-nav]");
  });
});
