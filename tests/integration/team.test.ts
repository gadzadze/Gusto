import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { allowedEmails, organizationMemberships, teamInvites } from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";
import { StateError } from "@/server/domain/errors";
import { ensureProfile } from "@/server/domain/profiles";
import { claimTeamInvites, inviteColleague, listTeam, removeMember, revokeInvite } from "@/server/domain/team/team";
import { createAuthUser, createBuyer, createSupplier } from "./helpers";

const mail = () => `colleague-${randomUUID().slice(0, 8)}@test.gusto.ge`;

/** Someone joins by signing in: their auth user and profile exist, then the invitations are claimed. */
async function signIn(email: string): Promise<OrgCtx & { userId: string }> {
  const user = await createAuthUser(email);
  await ensureProfile(user.id, "Colleague");
  return { userId: user.id } as OrgCtx & { userId: string };
}
const asMember = (user: { userId: string }, owner: OrgCtx): OrgCtx => ({ ...owner, userId: user.userId });
const allowedRow = async (email: string) => (await getDb().select().from(allowedEmails).where(eq(allowedEmails.email, email)))[0];

describe("team access", () => {
  it("an owner adds a colleague without admin approval; they join at their first sign-in", async () => {
    const owner = await createSupplier();
    const email = mail();
    const res = await inviteColleague(owner, `  ${email.toUpperCase()} `, "member");
    expect(res.orgIds).toEqual([owner.orgId]);
    expect(await allowedRow(email)).toMatchObject({ intendedRole: "supplier", revokedAt: null });
    expect((await listTeam(owner)).invites.map((i) => i.email)).toEqual([email]);

    const person = await signIn(email);
    expect(await claimTeamInvites(person.userId, email)).toBe(1);
    expect(await claimTeamInvites(person.userId, email)).toBe(0); // idempotent
    const team = await listTeam(owner);
    expect(team.invites).toEqual([]);
    expect(team.members.find((m) => m.userId === person.userId)).toMatchObject({ role: "member", email });
    // A member sees the team but cannot manage it.
    const member = asMember(person, owner);
    expect((await listTeam(member)).canManage).toBe(false);
    expect((await listTeam(member)).invites).toEqual([]);
    await expect(inviteColleague(member, mail(), "member")).rejects.toEqual(new StateError("not_owner"));
    await expect(removeMember(member, owner.userId)).rejects.toEqual(new StateError("not_owner"));
  });

  it("refuses duplicates, members, a blocked address, and companies that are not approved", async () => {
    const owner = await createSupplier();
    const email = mail();
    await inviteColleague(owner, email, "member");
    await expect(inviteColleague(owner, email, "member")).rejects.toEqual(new StateError("already_invited"));
    await expect(inviteColleague(owner, "not-an-email", "member")).rejects.toEqual(new StateError("invalid_email"));
    const person = await signIn(email);
    await claimTeamInvites(person.userId, email);
    await expect(inviteColleague(owner, email, "member")).rejects.toEqual(new StateError("already_member"));

    const blocked = mail();
    await getDb().insert(allowedEmails).values({ email: blocked, revokedAt: new Date() });
    await expect(inviteColleague(owner, blocked, "member")).rejects.toEqual(new StateError("blocked"));

    const waiting = await createSupplier("pending_review");
    await expect(inviteColleague(waiting, mail(), "member")).rejects.toEqual(new StateError("not_active"));
  });

  it("keeps at least one owner, lets people leave, and closes the door behind a removed colleague", async () => {
    const owner = await createSupplier();
    await expect(removeMember(owner, owner.userId)).rejects.toEqual(new StateError("last_owner"));
    const email = mail();
    await inviteColleague(owner, email, "owner");
    const person = await signIn(email);
    await claimTeamInvites(person.userId, email);
    const second = asMember(person, owner);
    // Two owners: now one may leave.
    expect((await removeMember(second, person.userId)).left).toBe(true);
    // The colleague belonged only to this company through a team invitation: their address no longer signs in.
    expect((await allowedRow(email)).revokedAt).not.toBeNull();
    // The owner is the last one again.
    await expect(removeMember(owner, owner.userId)).rejects.toEqual(new StateError("last_owner"));
  });

  it("does not revoke an address the admin registered, and removal only reaches this company", async () => {
    const owner = await createSupplier();
    const other = await createSupplier();
    const email = mail();
    await getDb().insert(allowedEmails).values({ email, note: "admin registered" });
    await inviteColleague(owner, email, "member");
    const person = await signIn(email);
    await claimTeamInvites(person.userId, email);
    await removeMember(owner, person.userId);
    expect((await allowedRow(email)).revokedAt).toBeNull();
    // Someone else's company cannot remove from this one: not found.
    await expect(removeMember(other, owner.userId)).rejects.toThrow();
    expect((await getDb().select().from(organizationMemberships).where(eq(organizationMemberships.userId, owner.userId))).length).toBe(1);
  });

  it("cancelling an invitation closes the door too", async () => {
    const owner = await createBuyer();
    const email = mail();
    await inviteColleague(owner, email, "member");
    const [invite] = (await listTeam(owner)).invites;
    await revokeInvite(owner, invite.id);
    expect((await allowedRow(email)).revokedAt).not.toBeNull();
    const person = await signIn(email);
    expect(await claimTeamInvites(person.userId, email)).toBe(0);
  });

  it("adds a colleague to several of my companies at once, but only ones I own", async () => {
    const a = await createSupplier();
    const brandB = await createSupplier();
    // Same person owns both: give them a membership of brandB.
    await getDb().insert(organizationMemberships).values({ organizationId: brandB.orgId, userId: a.userId, role: "owner" });
    const stranger = await createSupplier();
    const email = mail();
    const res = await inviteColleague(a, email, "member", [brandB.orgId, stranger.orgId, randomUUID()]);
    expect(res.orgIds.sort()).toEqual([a.orgId, brandB.orgId].sort());
    const open = await getDb().select().from(teamInvites).where(eq(teamInvites.email, email));
    expect(open.map((i) => i.organizationId)).not.toContain(stranger.orgId);
    const person = await signIn(email);
    expect(await claimTeamInvites(person.userId, email)).toBe(2);
    expect(await getDb().select().from(organizationMemberships).where(and(eq(organizationMemberships.userId, person.userId)))).toHaveLength(2);
  });
});
