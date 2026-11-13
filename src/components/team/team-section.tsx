import { getFormatter } from "next-intl/server";
import { TeamManager } from "@/components/team/team-manager";
import type { OrgCtx } from "@/server/domain/context";
import { listOwnedCompanies, listTeam } from "@/server/domain/team/team";

/** The team of the acting company (shared by the supplier and the buyer area). */
export async function TeamSection({ ctx }: { ctx: OrgCtx }) {
  const format = await getFormatter();
  const [team, others] = await Promise.all([listTeam(ctx), listOwnedCompanies(ctx)]);
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium" });
  return (
    <TeamManager
      canManage={team.canManage}
      members={team.members.map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role, you: m.you, joined: date(m.joinedAt) }))}
      invites={team.invites.map((i) => ({ id: i.id, email: i.email, role: i.role, created: date(i.createdAt) }))}
      otherCompanies={team.canManage ? others : []}
    />
  );
}
