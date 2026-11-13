"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { sendTeamInviteEmail } from "@/server/auth/team-invite-email";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireOrg } from "@/server/auth/guards";
import { inviteColleague, removeMember, revokeInvite, type TeamError } from "@/server/domain/team/team";

// Shared by the supplier and the buyer area. The guard gives the acting company; the domain functions
// check that the caller is an owner of it. A company id in the input is only ever checked against the
// caller's own memberships.

type Err = ActionError<TeamError | "invalid">;
const id = z.uuid();
const inviteSchema = z.object({
  email: z.string().trim().min(3).max(254),
  role: z.enum(["member", "owner"]),
  alsoOrgIds: z.array(id).max(10).optional(),
});

export async function inviteColleagueAction(raw: unknown): Promise<{ ok: true; emailed: "sent" | "skipped" | "failed" } | Err> {
  const ctx = await requireOrg();
  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true; emailed: "sent" | "skipped" | "failed" }, TeamError | "invalid">("inviteColleague", async () => {
    const result = await inviteColleague(ctx, parsed.data.email, parsed.data.role, parsed.data.alsoOrgIds ?? []);
    // Sent directly (the text holds a one-time link); a failure is reported, never undoes the invitation.
    const emailed = await sendTeamInviteEmail(result.email, result.orgNames);
    refresh();
    return { ok: true, emailed };
  });
}

export async function revokeTeamInviteAction(inviteId: string): Promise<{ ok: true } | Err> {
  const ctx = await requireOrg();
  if (!id.safeParse(inviteId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, TeamError | "invalid">("revokeTeamInvite", async () => {
    await revokeInvite(ctx, inviteId);
    refresh();
    return { ok: true };
  });
}

export async function removeTeamMemberAction(userId: string): Promise<{ ok: true; left: boolean } | Err> {
  const ctx = await requireOrg();
  if (!id.safeParse(userId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true; left: boolean }, TeamError | "invalid">("removeTeamMember", async () => {
    const { left } = await removeMember(ctx, userId);
    refresh();
    return { ok: true, left };
  });
}
