import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ka from "../../messages/ka.json";

// Both languages must say the same things: same keys, same placeholders, nothing left blank
// and no Georgian text in the English file. (A missing key would show as a raw key name.)

type Tree = { [key: string]: Tree | Tree[] | string };

function leaves(node: Tree | Tree[] | string, path: string, out: Map<string, string>) {
  if (typeof node === "string") out.set(path, node);
  else if (Array.isArray(node)) node.forEach((n, i) => leaves(n, `${path}[${i}]`, out));
  else for (const [k, v] of Object.entries(node)) leaves(v, path ? `${path}.${k}` : k, out);
}

const flat = (messages: unknown) => {
  const out = new Map<string, string>();
  leaves(messages as Tree, "", out);
  return out;
};

const kaFlat = flat(ka);
const enFlat = flat(en);
// ICU placeholders: {name} and the argument of {count, plural, ...}; "#" inside a plural is not one.
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
const tags = (s: string) => [...s.matchAll(/<\/?(\w+)>/g)].map((m) => m[0]).sort();

describe("messages: Georgian and English match", () => {
  it("have exactly the same keys", () => {
    expect([...enFlat.keys()].filter((k) => !kaFlat.has(k))).toEqual([]);
    expect([...kaFlat.keys()].filter((k) => !enFlat.has(k))).toEqual([]);
  });

  it("use the same placeholders and rich-text tags in every message", () => {
    for (const [key, text] of kaFlat) {
      const other = enFlat.get(key) ?? "";
      expect(placeholders(other), key).toEqual(placeholders(text));
      expect(tags(other), key).toEqual(tags(text));
    }
  });

  it("leave no English message empty", () => {
    for (const [key, text] of enFlat) expect(text.trim(), key).not.toBe("");
  });

  it("have no Georgian letters in English, except an example of Georgian typing", () => {
    const allowed = new Set(["buyer.searchHint"]);
    for (const [key, text] of enFlat) {
      if (allowed.has(key)) continue;
      expect(text, key).not.toMatch(/[Ⴀ-ჿ]/);
    }
  });

  it("use the standard hyphen only, never an em or en dash", () => {
    for (const [key, text] of enFlat) expect(text, key).not.toMatch(/[–—]/);
  });

  it("have no soft hyphens in English (they are for Georgian syllable breaks)", () => {
    for (const [key, text] of enFlat) expect(text, key).not.toContain("­");
  });
});
