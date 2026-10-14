import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { addresses } from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";

export type AddressOption = { id: string; city: string; addressLine: string; instructions: string | null; isDefault: boolean };

export async function listAddresses(ctx: OrgCtx): Promise<AddressOption[]> {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  return getDb()
    .select({
      id: addresses.id,
      city: addresses.city,
      addressLine: addresses.addressLine,
      instructions: addresses.instructions,
      isDefault: addresses.isDefault,
    })
    .from(addresses)
    .where(eq(addresses.organizationId, ctx.orgId))
    .orderBy(desc(addresses.isDefault), asc(addresses.createdAt));
}
