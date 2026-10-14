import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

/**
 * Signs a fresh user in without an inbox: the Supabase admin API creates the
 * user and a magic link, and the browser follows the link's token hash
 * through the app's real /auth/confirm route.
 */
export async function signInAsNewUser(page: Page, label: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("E2E needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see README, 'Tests').");
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.gusto.ge`;

  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;

  await page.goto(`/auth/confirm?token_hash=${link.data.properties.hashed_token}&type=magiclink`);
  return email;
}
