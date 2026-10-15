import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import type { Page } from "@playwright/test";

/** A well-formed company ID no other e2e user has. */
export function randomLegalId(): string {
  return String(Math.floor(100_000_000 + Math.random() * 900_000_000));
}

/**
 * Sign-in is invite-only: puts an address on the allow-list, like `npm run user:allow` does.
 * `vetted` = the admin verified the business (name + legal ID), so its organization starts active.
 */
export async function allowEmail(email: string, vetted = true): Promise<void> {
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error("E2E needs DATABASE_URL (or DATABASE_URL_DIRECT) to allow-list its test users.");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`insert into allowed_emails (email, note, created_by_label, business_name, legal_id)
      values (${email.toLowerCase()}, 'e2e', 'e2e', ${vetted ? "[E2E] Vetted" : null}, ${vetted ? randomLegalId() : null})
      on conflict (email) do nothing`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** The user already chose their own password (otherwise every page sends them to /account/password). */
export async function markPasswordSet(userId: string): Promise<void> {
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error("E2E needs DATABASE_URL.");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`insert into profiles (id, password_set_at) values (${userId}, now())
      on conflict (id) do update set password_set_at = now()`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Signs a fresh user in without an inbox: the Supabase admin API creates the
 * user and a magic link, and the browser follows the link's token hash
 * through the app's real /auth/confirm route.
 */
export async function signInAsNewUser(
  page: Page,
  label: string,
  options: { vetted?: boolean; passwordSet?: boolean } = {},
): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("E2E needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see README, 'Tests').");
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.gusto.ge`;

  await allowEmail(email, options.vetted ?? true);
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  if (options.passwordSet ?? true) await markPasswordSet(created.data.user.id);
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;

  await page.goto(`/auth/confirm?token_hash=${link.data.properties.hashed_token}&type=magiclink`);
  return email;
}

/** Makes an existing user a platform admin through the real admin:grant script. */
export function grantAdmin(email: string): void {
  execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/admin-grant.ts", email], { stdio: "pipe" });
}
