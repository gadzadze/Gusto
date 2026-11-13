import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { organizationMemberships, organizations } from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";

// A person can run several supplier companies (the brands of one group, each its own legal entity
// with its own waybills and invoices). The "all brands" views read across them, but only across
// the companies this person is a member of and that the admin has approved: the set always comes
// from the database by the person's id, never from a request.

export type Brand = { id: string; name: string };

/** The approved supplier companies the acting person belongs to (always includes the acting one when approved). */
export async function listMyBrands(ctx: Pick<OrgCtx, "userId" | "orgType">): Promise<Brand[]> {
  if (ctx.orgType !== "supplier") return [];
  return getDb()
    .select({ id: organizations.id, name: organizations.name })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(and(eq(organizationMemberships.userId, ctx.userId), eq(organizations.type, "supplier"), eq(organizations.status, "active")))
    .orderBy(asc(organizations.name));
}

/** The organizations a request covers: just the acting one, or every brand of the person in "all" mode. */
export async function scopeOrgIds(ctx: OrgCtx, all: boolean): Promise<string[]> {
  if (!all) return [ctx.orgId];
  const brands = await listMyBrands(ctx);
  const ids = brands.map((b) => b.id);
  return ids.includes(ctx.orgId) && ids.length > 1 ? ids : [ctx.orgId];
}
