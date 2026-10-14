// Pure helpers for scripts/setup-local-env.ts (kept apart so they are unit-tested).

/** Parses `supabase status -o env` output: lines like KEY="value". */
export function parseStatusEnv(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(?:"(.*)"|(.*))$/.exec(line.trim());
    if (m) out[m[1]] = m[2] ?? m[3] ?? "";
  }
  return out;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Sets KEY=value in .env-style text: replaces an existing line or appends one. */
export function setEnvValue(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) return text.replace(re, () => line);
  return `${text.replace(/\s*$/, "")}\n${line}\n`;
}

export function getEnvValue(text: string, key: string): string | undefined {
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(text);
  return m ? m[1].trim().replace(/^"(.*)"$/, "$1") : undefined;
}

export type LocalEnvResult = { text: string; changed: string[] };

/**
 * Applies a local Supabase's URL and keys to .env text. Only for local
 * Supabase: refuses any API URL that is not a local address. Uses the JWT-style
 * keys (anon / service_role), which the Auth admin API needs; the newer sb_ keys
 * are not used. Generates a CRON_SECRET if it is missing or still the placeholder.
 */
export function applyLocalSupabase(text: string, status: Record<string, string>, randomSecret: () => string): LocalEnvResult {
  const need = ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY", "DB_URL"] as const;
  for (const k of need) if (!status[k]) throw new Error(`supabase status did not print ${k}. Is Supabase running? (npx supabase start)`);
  if (!isLocalUrl(status.API_URL)) throw new Error(`Refusing: API_URL ${status.API_URL} is not a local address.`);
  if (!status.ANON_KEY.startsWith("eyJ") || !status.SERVICE_ROLE_KEY.startsWith("eyJ")) {
    throw new Error("The anon and service_role keys should be JWTs starting with eyJ. Update the Supabase CLI and try again.");
  }

  const values: [string, string][] = [
    ["NEXT_PUBLIC_SUPABASE_URL", status.API_URL],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", status.ANON_KEY],
    ["SUPABASE_SERVICE_ROLE_KEY", status.SERVICE_ROLE_KEY],
    ["DATABASE_URL", status.DB_URL],
    ["DATABASE_URL_DIRECT", status.DB_URL],
  ];
  const cron = getEnvValue(text, "CRON_SECRET");
  if (!cron || cron.startsWith("replace-with")) values.push(["CRON_SECRET", randomSecret()]);

  let next = text;
  const changed: string[] = [];
  for (const [key, value] of values) {
    if (getEnvValue(next, key) !== value) changed.push(key);
    next = setEnvValue(next, key, value);
  }
  return { text: next, changed };
}
