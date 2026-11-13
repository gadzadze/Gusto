import { getFormatter } from "next-intl/server";
import { ConnectionsPanel, type RequestView } from "@/components/connections/connections-panel";
import type { OrgCtx } from "@/server/domain/context";
import { convertOpenInvitationsQuietly } from "@/server/domain/connections/convert";
import { getFindable, listConnectionRequests, type RequestRow } from "@/server/domain/connections/connections";
import { listPriceLists } from "@/server/domain/pricing/price-lists";

/** Loads what the connections panel needs for the acting organization and renders it (active businesses only). */
export async function ConnectionsSection({ ctx, inviteHref }: { ctx: OrgCtx; inviteHref: string }) {
  if (ctx.orgStatus !== "active") return null;
  const format = await getFormatter();
  // Invitations sent to this business by its code (before it was here, or while it was not findable).
  await convertOpenInvitationsQuietly(ctx.orgId);
  const [requests, findable, lists] = await Promise.all([
    listConnectionRequests(ctx),
    getFindable(ctx),
    ctx.orgType === "supplier" ? listPriceLists(ctx) : Promise.resolve([]),
  ]);
  const view = (row: RequestRow): RequestView => ({
    id: row.id,
    name: row.orgName,
    city: row.city,
    message: row.message,
    expires: format.dateTime(row.expiresAt, { dateStyle: "medium" }),
    offeredListName: row.offeredListName,
  });
  return (
    <ConnectionsPanel
      role={ctx.orgType}
      findable={findable}
      incoming={requests.incoming.map(view)}
      outgoing={requests.outgoing.map(view)}
      priceLists={lists.map((l) => ({ id: l.id, name: l.name, isDefault: l.isDefault }))}
      inviteHref={inviteHref}
    />
  );
}
