import "server-only";
import { eq, sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { getDb } from "@/server/db/client";
import { profiles } from "@/server/db/schema";
import { writeAudit } from "@/server/domain/audit";

export type GrantAdminResult =
  | { status: "granted"; userId: string }
  | { status: "already_admin"; userId: string }
  | { status: "no_such_user" };

/**
 * Makes an existing user a platform admin. The only way to create an admin:
 * there is deliberately no sign-up path or UI for it. The person must have
 * signed in once so their auth user exists.
 */
export async function grantPlatformAdmin(email: string, actorLabel: string): Promise<GrantAdminResult> {
  return getDb().transaction(async (tx) => {
    const [user] = await tx
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(sql`lower(${authUsers.email}) = lower(${email.trim()})`)
      .limit(1);
    if (!user) return { status: "no_such_user" };

    await tx.insert(profiles).values({ id: user.id }).onConflictDoNothing({ target: profiles.id });
    const [profile] = await tx
      .select({ isPlatformAdmin: profiles.isPlatformAdmin })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .for("update");
    if (profile.isPlatformAdmin) return { status: "already_admin", userId: user.id };

    await tx.update(profiles).set({ isPlatformAdmin: true }).where(eq(profiles.id, user.id));
    await writeAudit(tx, {
      actorUserId: null,
      actorLabel,
      action: "profile.platform_admin_granted",
      targetType: "profile",
      targetId: user.id,
    });
    return { status: "granted", userId: user.id };
  });
}
