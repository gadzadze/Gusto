import { describe, expect, it } from "vitest";
import { applyLocalSupabase, getEnvValue, isLocalUrl, parseStatusEnv, setEnvValue } from "../../scripts/env-local";

const STATUS = `Stopped services: [supabase_imgproxy_gusto]
WARN: INBUCKET_URL is deprecated
ANON_KEY="eyJanon.payload.sig"
API_URL="http://127.0.0.1:54321"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
SECRET_KEY="sb_secret_newstyle"
SERVICE_ROLE_KEY="eyJservice.payload.sig"
`;
const ENV = `NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_old
SUPABASE_SERVICE_ROLE_KEY=sb_secret_old
RESEND_API_KEY=
CRON_SECRET=replace-with-a-long-random-string
`;

describe("parseStatusEnv", () => {
  it("reads KEY=\"value\" lines and ignores noise", () => {
    const s = parseStatusEnv(STATUS);
    expect(s.API_URL).toBe("http://127.0.0.1:54321");
    expect(s.SERVICE_ROLE_KEY).toBe("eyJservice.payload.sig");
    expect(s.SECRET_KEY).toBe("sb_secret_newstyle");
    expect(Object.keys(s)).not.toContain("WARN");
  });
});

describe("applyLocalSupabase", () => {
  it("replaces the keys with the JWT ones, adds missing lines, keeps everything else", () => {
    const { text, changed } = applyLocalSupabase(ENV, parseStatusEnv(STATUS), () => "generated-secret");
    expect(getEnvValue(text, "SUPABASE_SERVICE_ROLE_KEY")).toBe("eyJservice.payload.sig");
    expect(getEnvValue(text, "NEXT_PUBLIC_SUPABASE_ANON_KEY")).toBe("eyJanon.payload.sig");
    expect(getEnvValue(text, "DATABASE_URL")).toBe("postgresql://postgres:postgres@127.0.0.1:54322/postgres");
    expect(getEnvValue(text, "DATABASE_URL_DIRECT")).toBe("postgresql://postgres:postgres@127.0.0.1:54322/postgres");
    expect(getEnvValue(text, "CRON_SECRET")).toBe("generated-secret");
    expect(getEnvValue(text, "NEXT_PUBLIC_APP_URL")).toBe("http://localhost:3000");
    expect(text).not.toContain("sb_secret_old");
    expect(changed).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(changed).not.toContain("NEXT_PUBLIC_SUPABASE_URL"); // already right
  });

  it("is idempotent and keeps a real CRON_SECRET", () => {
    const first = applyLocalSupabase(ENV, parseStatusEnv(STATUS), () => "s1").text;
    const second = applyLocalSupabase(first, parseStatusEnv(STATUS), () => "s2");
    expect(second.changed).toEqual([]);
    expect(getEnvValue(second.text, "CRON_SECRET")).toBe("s1");
  });

  it("refuses a non-local Supabase, new-style keys, and missing output", () => {
    const remote = { ...parseStatusEnv(STATUS), API_URL: "https://abc.supabase.co" };
    expect(() => applyLocalSupabase(ENV, remote, () => "x")).toThrow(/not a local address/);
    const newKeys = { ...parseStatusEnv(STATUS), SERVICE_ROLE_KEY: "sb_secret_x" };
    expect(() => applyLocalSupabase(ENV, newKeys, () => "x")).toThrow(/eyJ/);
    expect(() => applyLocalSupabase(ENV, {}, () => "x")).toThrow(/Is Supabase running/);
  });
});

describe("env helpers", () => {
  it("setEnvValue replaces or appends; isLocalUrl checks the host", () => {
    expect(setEnvValue("A=1\nB=2\n", "A", "9")).toBe("A=9\nB=2\n");
    expect(setEnvValue("A=1", "C", "3")).toBe("A=1\nC=3\n");
    expect(isLocalUrl("http://localhost:54321")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1.evil.example")).toBe(false);
    expect(isLocalUrl("nonsense")).toBe(false);
  });
});
