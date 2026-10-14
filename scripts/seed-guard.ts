// Decides whether the dev seed may run against a database. Pure, so it is
// unit-tested: the seed must never touch production data.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);

export type SeedGuard = { ok: true; host: string } | { ok: false; reason: string };

/**
 * Allowed: a local host, or a host listed in `allowList` (comma-separated, the
 * SEED_ALLOWED_HOSTS variable, meant for a dedicated dev Supabase project).
 * Production environments are refused outright.
 */
export function checkSeedTarget(databaseUrl: string | undefined, allowList: string | undefined, nodeEnv?: string): SeedGuard {
  if (nodeEnv === "production") return { ok: false, reason: "NODE_ENV is production." };
  if (!databaseUrl) return { ok: false, reason: "DATABASE_URL is not set." };
  let host: string;
  try {
    host = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return { ok: false, reason: "DATABASE_URL is not a valid URL." };
  }
  if (LOCAL_HOSTS.has(host)) return { ok: true, host };
  const allowed = (allowList ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.includes(host)) return { ok: true, host };
  return {
    ok: false,
    reason: `host "${host}" is neither local nor listed in SEED_ALLOWED_HOSTS. Seed data is for local or dedicated dev databases only.`,
  };
}
