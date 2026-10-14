import "server-only";
import { getDb } from "@/server/db/client";
import { profiles } from "@/server/db/schema";

/** Creates the profile row for a freshly signed-in user. Idempotent. */
export async function ensureProfile(userId: string, fullName?: string | null): Promise<void> {
  await getDb()
    .insert(profiles)
    .values({ id: userId, fullName: fullName ?? null })
    .onConflictDoNothing({ target: profiles.id });
}
