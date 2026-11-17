import "server-only";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { normalizeEmail } from "@/lib/auth/invite-path";
import { z } from "zod";
import { getDb, type Tx } from "@/server/db/client";
import { allowedEmails, organizationMemberships, organizations, profiles, teamInvites, type MembershipRole } from "@/server/db/schema";
import { writeAudit } from "@/server/domain/audit";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError, StateError, isUniqueViolation } from "@/server/domain/errors";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";

// Several people can work in one company, each with their own sign-in. The owner of a company adds
// colleagues by email; nobody at 202 approves them, because the company itself was already vetted.
// A colleague's address is let into sign-in (allowed_emails, note "team:<organization id>") and joins at
// the first sign-in. Only owners manage the team; every member works with orders and the catalog.
// A company always keeps at least one owner.

export type TeamError =
  | "invalid_email"
  | "not_owner"
  | "not_active"
  | "already_member"
  | "already_invited"
  | "blocked"
  | "too_many"
  | "last_owner"
  | "rate_limited";

const accessEmailSchema = z.email().max(254);

export const MAX_TEAM_SIZE = 20;
export const TEAM_NOTE_PREFIX = "team:";

type Db = ReturnType<typeof getDb> | Tx;

async function assertOwner(db: Db, ctx: Pick<OrgCtx, "userId" | "orgId">): Promise<void> {
  const [m] = await db
    .select({ role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, ctx.orgId), eq(organizationMemberships.userId, ctx.userId)));
  if (!m) throw new NotFoundError("organization");
  if (m.role !== "owner") throw new StateError<TeamError>("not_owner");
}

export type TeamMember = { userId: string; name: string | null; email: string | null; role: MembershipRole; you: boolean; joinedAt: Date };
export type TeamInvite = { id: string; email: string; role: MembershipRole; createdAt: Date };

/** Everyone in the acting company and the open invitations. Members can see the team; only owners manage it. */
export async function listTeam(ctx: OrgCtx): Promise<{ canManage: boolean; members: TeamMember[]; invites: TeamInvite[] }> {
  const db = getDb();
  const [me] = await db
    .select({ role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, ctx.orgId), eq(organizationMemberships.userId, ctx.userId)));
  if (!me) throw new NotFoundError("organization");
  const rows = await db
    .select({
      userId: organizationMemberships.userId,
      role: organizationMemberships.role,
      joinedAt: organizationMemberships.createdAt,
      name: profiles.fullName,
      email: authUsers.email,
    })
    .from(organizationMemberships)
    .innerJoin(profiles, eq(profiles.id, organizationMemberships.userId))
    .leftJoin(authUsers, eq(authUsers.id, organizationMemberships.userId))
    .where(eq(organizationMemberships.organizationId, ctx.orgId))
    .orderBy(asc(organizationMemberships.createdAt));
  const invites =
    me.role === "owner"
      ? await db
          .select({ id: teamInvites.id, email: teamInvites.email, role: teamInvites.role, createdAt: teamInvites.createdAt })
          .from(teamInvites)
          .where(and(eq(teamInvites.organizationId, ctx.orgId), isNull(teamInvites.acceptedAt), isNull(teamInvites.revokedAt)))
          .orderBy(asc(teamInvites.createdAt))
      : [];
  return {
    canManage: me.role === "owner",
    members: rows.map((r) => ({ ...r, you: r.userId === ctx.userId })),
    invites,
  };
}

/**
 * The owner adds a colleague. Returns which companies got an invitation (the acting one plus any
 * other company where the same person is also an owner and of the same kind, chosen by `alsoOrgIds`).
 */
export async function inviteColleague(
  ctx: OrgCtx,
  rawEmail: string,
  role: MembershipRole,
  alsoOrgIds: string[] = [],
): Promise<{ email: string; orgIds: string[]; orgNames: string[] }> {
  if (ctx.orgStatus !== "active") throw new StateError<TeamError>("not_active");
  const parsed = accessEmailSchema.safeParse(normalizeEmail(rawEmail));
  if (!parsed.success) throw new StateError<TeamError>("invalid_email");
  const email = parsed.data;
  await consumeRateLimit(RATE_LIMITS.teamInvite, ctx.orgId);

  return getDb().transaction(async (tx) => {
    await assertOwner(tx, ctx);
    // Other companies: only ones this person owns, of the same kind and approved. Anything else is ignored.
    const mine = alsoOrgIds.length
      ? await tx
          .select({ id: organizations.id, name: organizations.name })
          .from(organizationMemberships)
          .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
          .where(
            and(
              eq(organizationMemberships.userId, ctx.userId),
              eq(organizationMemberships.role, "owner"),
              inArray(organizations.id, alsoOrgIds),
              eq(organizations.type, ctx.orgType),
              eq(organizations.status, "active"),
            ),
          )
      : [];
    const [self] = await tx.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId));
    const targets = [self, ...mine.filter((o) => o.id !== ctx.orgId)];

    // The admin's block on an address overrides everything.
    const [allowed] = await tx.select().from(allowedEmails).where(eq(allowedEmails.email, email)).for("update");
    if (allowed?.revokedAt) throw new StateError<TeamError>("blocked");

    const [existingUser] = await tx.select({ id: authUsers.id }).from(authUsers).where(sql`lower(${authUsers.email}) = ${email}`);
    const done: { id: string; name: string }[] = [];
    for (const org of targets) {
      const [size] = await tx.select({ n: count() }).from(organizationMemberships).where(eq(organizationMemberships.organizationId, org.id));
      const [pending] = await tx
        .select({ n: count() })
        .from(teamInvites)
        .where(and(eq(teamInvites.organizationId, org.id), isNull(teamInvites.acceptedAt), isNull(teamInvites.revokedAt)));
      if ((size?.n ?? 0) + (pending?.n ?? 0) >= MAX_TEAM_SIZE) {
        if (org.id === ctx.orgId) throw new StateError<TeamError>("too_many");
        continue;
      }
      if (existingUser) {
        const [member] = await tx
          .select({ id: organizationMemberships.id })
          .from(organizationMemberships)
          .where(and(eq(organizationMemberships.organizationId, org.id), eq(organizationMemberships.userId, existingUser.id)));
        if (member) {
          if (org.id === ctx.orgId) throw new StateError<TeamError>("already_member");
          continue;
        }
      }
      try {
        await tx.insert(teamInvites).values({ organizationId: org.id, email, role, invitedByUserId: ctx.userId });
      } catch (error) {
        if (isUniqueViolation(error, "team_invites_open_key")) {
          if (org.id === ctx.orgId) throw new StateError<TeamError>("already_invited");
          continue;
        }
        throw error;
      }
      await writeAudit(tx, {
        actorUserId: ctx.userId,
        action: "team.invited",
        targetType: "organization",
        targetId: org.id,
        data: { role },
      });
      done.push(org);
    }
    // Let the address sign in. An address the admin already registered keeps its own row untouched.
    if (!allowed) {
      await tx.insert(allowedEmails).values({
        email,
        note: `${TEAM_NOTE_PREFIX}${ctx.orgId}`,
        intendedRole: ctx.orgType,
        createdByUserId: ctx.userId,
      });
    }
    return { email, orgIds: done.map((o) => o.id), orgNames: done.map((o) => o.name) };
  });
}

export async function revokeInvite(ctx: OrgCtx, inviteId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(inviteId)) throw new NotFoundError("invite");
  await getDb().transaction(async (tx) => {
    await assertOwner(tx, ctx);
    const revoked = await tx
      .update(teamInvites)
      .set({ revokedAt: new Date() })
      .where(and(eq(teamInvites.id, inviteId), eq(teamInvites.organizationId, ctx.orgId), isNull(teamInvites.acceptedAt), isNull(teamInvites.revokedAt)))
      .returning({ email: teamInvites.email });
    if (revoked.length === 0) throw new NotFoundError("invite");
    await writeAudit(tx, { actorUserId: ctx.userId, action: "team.invite_revoked", targetType: "organization", targetId: ctx.orgId });
    await closeDoorIfUnused(tx, revoked[0].email);
  });
}

/**
 * Removes a person from the acting company (an owner removes anyone; anyone may leave). The last owner
 * cannot go. A person who joined only through a team invitation and now belongs to no company loses the
 * right to sign in; an address the admin registered is left alone.
 */
export async function removeMember(ctx: OrgCtx, userId: string): Promise<{ left: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new NotFoundError("member");
  const leaving = userId === ctx.userId;
  return getDb().transaction(async (tx) => {
    if (!leaving) await assertOwner(tx, ctx);
    // Lock the company's memberships so two owners cannot remove each other at once.
    const members = await tx
      .select({ userId: organizationMemberships.userId, role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, ctx.orgId))
      .for("update");
    const target = members.find((m) => m.userId === userId);
    if (!target || !members.some((m) => m.userId === ctx.userId)) throw new NotFoundError("member");
    if (target.role === "owner" && members.filter((m) => m.role === "owner").length <= 1) throw new StateError<TeamError>("last_owner");
    await tx.delete(organizationMemberships).where(and(eq(organizationMemberships.organizationId, ctx.orgId), eq(organizationMemberships.userId, userId)));
    await writeAudit(tx, {
      actorUserId: ctx.userId,
      action: leaving ? "team.left" : "team.removed",
      targetType: "organization",
      targetId: ctx.orgId,
      data: { userId },
    });
    const [rest] = await tx.select({ n: count() }).from(organizationMemberships).where(eq(organizationMemberships.userId, userId));
    if ((rest?.n ?? 0) === 0) {
      const [u] = await tx.select({ email: authUsers.email }).from(authUsers).where(eq(authUsers.id, userId));
      if (u?.email) await closeDoorIfUnused(tx, normalizeEmail(u.email), true);
    }
    return { left: leaving };
  });
}

/** Revokes the allow-list row of a team-added address once nothing needs it (no company, no open invitation). */
async function closeDoorIfUnused(tx: Tx, email: string, personHasNoCompany = false): Promise<void> {
  const [row] = await tx.select().from(allowedEmails).where(eq(allowedEmails.email, email)).for("update");
  if (!row || row.revokedAt || !row.note?.startsWith(TEAM_NOTE_PREFIX)) return;
  const [open] = await tx
    .select({ n: count() })
    .from(teamInvites)
    .where(and(eq(teamInvites.email, email), isNull(teamInvites.acceptedAt), isNull(teamInvites.revokedAt)));
  if ((open?.n ?? 0) > 0) return;
  if (!personHasNoCompany) {
    const [u] = await tx.select({ id: authUsers.id }).from(authUsers).where(sql`lower(${authUsers.email}) = ${email}`);
    if (u) {
      const [m] = await tx.select({ n: count() }).from(organizationMemberships).where(eq(organizationMemberships.userId, u.id));
      if ((m?.n ?? 0) > 0) return;
    }
  }
  await tx.update(allowedEmails).set({ revokedAt: new Date() }).where(eq(allowedEmails.id, row.id));
}

/**
 * Called at sign-in: every open invitation addressed to this person's email puts them in that company.
 * Returns how many companies they joined. Safe to call repeatedly.
 */
export async function claimTeamInvites(userId: string, rawEmail: string): Promise<number> {
  const email = normalizeEmail(rawEmail);
  return getDb().transaction(async (tx) => {
    const open = await tx
      .select({ id: teamInvites.id, organizationId: teamInvites.organizationId, role: teamInvites.role })
      .from(teamInvites)
      .innerJoin(organizations, eq(organizations.id, teamInvites.organizationId))
      .where(and(eq(teamInvites.email, email), isNull(teamInvites.acceptedAt), isNull(teamInvites.revokedAt)))
      .for("update", { of: teamInvites });
    let joined = 0;
    for (const invite of open) {
      await tx
        .insert(organizationMemberships)
        .values({ organizationId: invite.organizationId, userId, role: invite.role })
        .onConflictDoNothing({ target: [organizationMemberships.organizationId, organizationMemberships.userId] });
      await tx.update(teamInvites).set({ acceptedAt: new Date() }).where(eq(teamInvites.id, invite.id));
      await writeAudit(tx, { actorUserId: userId, action: "team.joined", targetType: "organization", targetId: invite.organizationId, data: { role: invite.role } });
      joined += 1;
    }
    return joined;
  });
}

/** Other approved companies of the same kind that this person owns (a colleague can be added to several at once). */
export async function listOwnedCompanies(ctx: OrgCtx): Promise<{ id: string; name: string }[]> {
  const rows = await getDb()
    .select({ id: organizations.id, name: organizations.name })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(
      and(
        eq(organizationMemberships.userId, ctx.userId),
        eq(organizationMemberships.role, "owner"),
        eq(organizations.type, ctx.orgType),
        eq(organizations.status, "active"),
      ),
    )
    .orderBy(asc(organizations.name));
  return rows.filter((r) => r.id !== ctx.orgId);
}
