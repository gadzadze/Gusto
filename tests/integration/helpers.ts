import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";

/** Inserts a user into the auth.users stand-in, as Supabase Auth would on sign-up. */
export async function createAuthUser(email = `user-${randomUUID()}@test.gusto.ge`): Promise<{ id: string; email: string }> {
  const rows = await getDb().execute<{ id: string }>(
    sql`insert into auth.users (email) values (${email}) returning id`,
  );
  return { id: rows[0].id, email };
}
