import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { z } from "zod";
import { normalizeEmail } from "@/lib/auth/invite-path";
import { getDb } from "@/server/db/client";
import { allowedEmails } from "@/server/db/schema";
import { writeAudit } from "@/server/domain/audit";
import { assertAdmin, type AdminCtx } from "@/server/domain/context";
import { NotFoundError, StateError } from "@/server/domain/errors";

// Who may sign in (see server/auth/allow-list.ts for the rules). Registering
// an address does not give it a role: the person still onboards, and a supplier
// still waits for approval.

export type AccessError = "invalid_email" | "cannot_revoke_self";

export const accessEmailSchema = z.email().max(254);
export const noteSchema = z.string().trim().max(200);

export type Actor = { userId: string | null; label?: string };

export type AllowResult = { status: "allowed" | "restored" | "updated" | "already_allowed"; email: string };

export type IntendedRole = "buyer" | "supplier" | null;

/**
 * Puts an address on the allow-list (or lifts a revocation). Used by the admin
 * page (Actor = the admin) and by scripts (Actor = a label). Audited.
 */
export async function allowEmail(
  actor: Actor,
  rawEmail: string,
  rawNote?: string,
  role?: IntendedRole,
): Promise<AllowResult> {
  const parsed = accessEmailSchema.safeParse(normalizeEmail(rawEmail));
  if (!parsed.success) throw new StateError<AccessError>("invalid_email");
  const email = parsed.data;
  const note = noteSchema.parse(rawNote ?? "") || null;

  return getDb().transaction(async (tx) => {
    const [existing] = await tx.select().from(allowedEmails).where(eq(allowedEmails.email, email)).for("update");
    let status: AllowResult["status"];
    if (!existing) {
      await tx.insert(allowedEmails).values({
        email,
        note,
        intendedRole: role ?? null,
        createdByUserId: actor.userId,
        createdByLabel: actor.label ?? null,
      });
      status = "allowed";
    } else if (existing.revokedAt) {
      await tx
        .update(allowedEmails)
        .set({ revokedAt: null, ...(note ? { note } : {}), ...(role !== undefined ? { intendedRole: role } : {}) })
        .where(eq(allowedEmails.id, existing.id));
      status = "restored";
    } else if (role !== undefined && role !== existing.intendedRole) {
      // Re-adding with a different role changes the pin (null = either).
      await tx
        .update(allowedEmails)
        .set({ intendedRole: role, ...(note ? { note } : {}) })
        .where(eq(allowedEmails.id, existing.id));
      status = "updated";
    } else {
      return { status: "already_allowed", email };
    }
    await writeAudit(tx, {
      actorUserId: actor.userId,
      actorLabel: actor.label,
      action: "access.allow",
      targetType: "allowed_email",
      targetId: email,
      data: { status, note, role: role ?? null },
    });
    return { status, email };
  });
}

export async function revokeEmail(ctx: AdminCtx, id: string): Promise<void> {
  assertAdmin(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("allowed email");
  await getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(allowedEmails).where(eq(allowedEmails.id, id)).for("update");
    if (!row) throw new NotFoundError("allowed email");
    // An admin can't lock themselves out by accident.
    const [me] = await tx.select({ email: authUsers.email }).from(authUsers).where(eq(authUsers.id, ctx.userId));
    if (me?.email && normalizeEmail(me.email) === row.email) throw new StateError<AccessError>("cannot_revoke_self");
    if (row.revokedAt) return;
    await tx.update(allowedEmails).set({ revokedAt: new Date() }).where(eq(allowedEmails.id, id));
    await writeAudit(tx, {
      actorUserId: ctx.userId,
      action: "access.revoke",
      targetType: "allowed_email",
      targetId: row.email,
    });
  });
}

export async function listAllowedEmails(ctx: AdminCtx) {
  assertAdmin(ctx);
  return getDb().select().from(allowedEmails)// Active first, newest first.
    .orderBy(sql`(${allowedEmails.revokedAt} is not null)`, desc(allowedEmails.createdAt)).limit(500);
}
