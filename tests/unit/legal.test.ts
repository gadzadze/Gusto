import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import ka from "../../messages/ka.json";
import { PASSWORD_MIN } from "@/lib/validation/password";
import { LEGAL_UPDATED, legalOperator } from "@/lib/legal";

type Section = { title: string; paragraphs?: string[]; items?: string[]; closing?: string[] };
const documents = { terms: ka.legal.terms, privacy: ka.legal.privacy } as const;

function allText(doc: { title: string; intro: string; sections: Section[] }): string {
  return [
    doc.title,
    doc.intro,
    ...doc.sections.flatMap((s) => [s.title, ...(s.paragraphs ?? []), ...(s.items ?? []), ...(s.closing ?? [])]),
  ].join("\n");
}

describe("legal documents", () => {
  for (const [name, doc] of Object.entries(documents)) {
    it(`${name}: every section has a title and some text`, () => {
      expect(doc.sections.length).toBeGreaterThanOrEqual(8);
      for (const section of doc.sections as Section[]) {
        expect(section.title.trim()).not.toBe("");
        const body = [...(section.paragraphs ?? []), ...(section.items ?? []), ...(section.closing ?? [])];
        expect(body.length, section.title).toBeGreaterThan(0);
        for (const text of body) expect(text.trim(), section.title).not.toBe("");
      }
    });

    it(`${name}: section titles are unique (they are React keys)`, () => {
      const titles = (doc.sections as Section[]).map((s) => s.title);
      expect(new Set(titles).size).toBe(titles.length);
    });

    it(`${name}: only the standard hyphen, no em or en dashes`, () => {
      expect(allText(doc as never)).not.toMatch(/[–—]/);
    });

    it(`${name}: no leftover placeholders`, () => {
      expect(allText(doc as never)).not.toMatch(/TODO|TBD|XXX|\[[^\]]*\]/i);
    });
  }

  it("the terms quote the real minimum password length", () => {
    expect(allText(ka.legal.terms as never)).toContain(`${PASSWORD_MIN} სიმბოლო`);
  });

  it("the privacy policy's backup retention matches the backup workflow", () => {
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/db-backup.yml"), "utf8");
    const days = /retention-days:\s*(\d+)/.exec(workflow)?.[1];
    expect(days).toBeDefined();
    expect(allText(ka.legal.privacy as never)).toContain(`${days} დღე`);
  });

  it("names the processors the code actually uses", () => {
    const text = allText(ka.legal.privacy as never);
    for (const processor of ["Supabase", "Vercel", "Resend", "Google"]) expect(text).toContain(processor);
  });

  it("the last-updated date is a real date", () => {
    expect(Number.isNaN(new Date(`${LEGAL_UPDATED}T12:00:00Z`).getTime())).toBe(false);
  });

  it("the linking notes on sign-in and the request form use the expected tags", () => {
    expect(ka.login.legalNote).toMatch(/<terms>.+<\/terms>/);
    expect(ka.login.legalNote).toMatch(/<privacy>.+<\/privacy>/);
    expect(ka.supplierRequest.privacyNote).toMatch(/<privacy>.+<\/privacy>/);
  });
});

describe("legalOperator", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of ["LEGAL_ENTITY_NAME", "LEGAL_ENTITY_ID", "LEGAL_ADDRESS", "LEGAL_CONTACT_EMAIL"]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("is null until the entity name is set, so nothing is invented", () => {
    delete process.env.LEGAL_ENTITY_NAME;
    process.env.LEGAL_ADDRESS = "Somewhere 1";
    expect(legalOperator()).toBeNull();
    process.env.LEGAL_ENTITY_NAME = "   ";
    expect(legalOperator()).toBeNull();
  });

  it("returns what is set and null for the rest", () => {
    process.env.LEGAL_ENTITY_NAME = " Example LLC ";
    delete process.env.LEGAL_ENTITY_ID;
    delete process.env.LEGAL_ADDRESS;
    process.env.LEGAL_CONTACT_EMAIL = "legal@example.test";
    expect(legalOperator()).toEqual({
      name: "Example LLC",
      id: null,
      address: null,
      email: "legal@example.test",
    });
  });
});
