import { describe, expect, it } from "vitest";
import { checkSeedTarget } from "../../scripts/seed-guard";

describe("seed guard", () => {
  it.each([
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    "postgresql://postgres:postgres@localhost:5432/gusto",
    "postgresql://u:p@[::1]:5432/db",
    "postgresql://u:p@host.docker.internal:5432/db",
  ])("allows local %s", (url) => {
    expect(checkSeedTarget(url, undefined).ok).toBe(true);
  });

  it("refuses a Supabase production host", () => {
    const r = checkSeedTarget("postgresql://postgres.abc:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres", undefined);
    expect(r).toMatchObject({ ok: false });
  });

  it("allows a host only if it is on the allow-list (case and spaces ignored)", () => {
    const url = "postgresql://u:p@db.devproject.supabase.co:5432/postgres";
    expect(checkSeedTarget(url, "").ok).toBe(false);
    expect(checkSeedTarget(url, "db.other.supabase.co").ok).toBe(false);
    expect(checkSeedTarget(url, " DB.devproject.supabase.co , x ").ok).toBe(true);
  });

  it("does not let a look-alike hostname through", () => {
    expect(checkSeedTarget("postgresql://u:p@localhost.evil.example:5432/db", undefined).ok).toBe(false);
    expect(checkSeedTarget("postgresql://u:p@evil.example:5432/db?host=localhost", undefined).ok).toBe(false);
    expect(checkSeedTarget("postgresql://127.0.0.1@evil.example:5432/db", undefined).ok).toBe(false);
  });

  it("refuses in production, with no URL, or with a broken URL", () => {
    expect(checkSeedTarget("postgresql://u:p@localhost:5432/db", undefined, "production").ok).toBe(false);
    expect(checkSeedTarget(undefined, undefined).ok).toBe(false);
    expect(checkSeedTarget("not a url", undefined).ok).toBe(false);
  });
});
