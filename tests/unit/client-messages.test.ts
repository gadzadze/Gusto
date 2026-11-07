import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ka from "../../messages/ka.json";
import { CLIENT_NAMESPACES, pickMessages } from "@/i18n/client-messages";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

const covered = (namespace: string) => CLIENT_NAMESPACES.some((n) => namespace === n || namespace.startsWith(`${n}.`));

describe("client messages", () => {
  it("cover every namespace a component asks useTranslations for", () => {
    const missing = new Set<string>();
    for (const file of sourceFiles(join(__dirname, "../../src"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/useTranslations\(\s*["']([\w.]+)["']\s*\)/g)) {
        if (!covered(m[1])) missing.add(`${m[1]} (${file.split("/src/")[1]})`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("keep the namespaces the namespace-less Field component reads", () => {
    expect(covered("onboarding")).toBe(true);
    expect(covered("validation")).toBe(true);
  });

  it("name namespaces that exist in the messages", () => {
    const picked = pickMessages(ka, CLIENT_NAMESPACES) as Record<string, unknown>;
    expect(picked.buyer).toBeDefined();
    expect((picked.landing as Record<string, unknown>).nav).toBeDefined();
    // Only the nav part of the landing page, and none of the long legal text.
    expect(Object.keys(picked.landing as object)).toEqual(["nav"]);
    expect(picked.legal).toBeUndefined();
    for (const path of CLIENT_NAMESPACES) {
      let node: unknown = ka;
      for (const key of path.split(".")) node = (node as Record<string, unknown>)?.[key];
      expect(node, path).toBeDefined();
    }
  });
});
