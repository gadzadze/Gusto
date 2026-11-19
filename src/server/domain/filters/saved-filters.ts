import "server-only";
import { and, asc, count, eq } from "drizzle-orm";
import { canonicalQuery, cleanFilterName, MAX_SAVED_FILTERS, type SavedFilterList } from "@/lib/saved-filters";
import { getDb } from "@/server/db/client";
import { savedFilters } from "@/server/db/schema";
import { assertSupplier, type OrgCtx } from "@/server/domain/context";
import { ConflictError, isUniqueViolation, NotFoundError, StateError } from "@/server/domain/errors";

// A person's saved views of a list, per user and per company: the scope is always the acting user and the
// acting company from the guard, never from the request. Today only the supplier product list uses it.

export type SavedFilterError = "name_required" | "nothing_to_save" | "too_many" | "name_taken";

export type SavedFilter = { id: string; name: string; query: string };

export async function listSavedFilters(ctx: OrgCtx, list: SavedFilterList): Promise<SavedFilter[]> {
  assertSupplier(ctx);
  const rows = await getDb()
    .select({ id: savedFilters.id, name: savedFilters.name, query: savedFilters.query })
    .from(savedFilters)
    .where(and(eq(savedFilters.userId, ctx.userId), eq(savedFilters.organizationId, ctx.orgId), eq(savedFilters.list, list)))
    .orderBy(asc(savedFilters.createdAt), asc(savedFilters.name));
  // Rebuilt through the whitelist again, so an old or hand-edited row cannot put anything else in a link.
  return rows.map((r) => ({ ...r, query: canonicalQuery(list, r.query) }));
}

export async function createSavedFilter(ctx: OrgCtx, list: SavedFilterList, rawName: string, rawQuery: string): Promise<string> {
  assertSupplier(ctx);
  const name = cleanFilterName(rawName);
  if (!name) throw new StateError<SavedFilterError>("name_required");
  const query = canonicalQuery(list, rawQuery);
  if (!query) throw new StateError<SavedFilterError>("nothing_to_save");
  const db = getDb();
  const [{ n }] = await db
    .select({ n: count() })
    .from(savedFilters)
    .where(and(eq(savedFilters.userId, ctx.userId), eq(savedFilters.organizationId, ctx.orgId), eq(savedFilters.list, list)));
  if (n >= MAX_SAVED_FILTERS) throw new StateError<SavedFilterError>("too_many");
  try {
    const [row] = await db
      .insert(savedFilters)
      .values({ userId: ctx.userId, organizationId: ctx.orgId, list, name, query })
      .returning({ id: savedFilters.id });
    return row.id;
  } catch (error) {
    if (isUniqueViolation(error, "saved_filters_name_key")) throw new ConflictError<SavedFilterError>("name_taken");
    throw error;
  }
}

export async function deleteSavedFilter(ctx: OrgCtx, id: string): Promise<void> {
  assertSupplier(ctx);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(id)) throw new NotFoundError("saved filter");
  const deleted = await getDb()
    .delete(savedFilters)
    .where(and(eq(savedFilters.id, id), eq(savedFilters.userId, ctx.userId), eq(savedFilters.organizationId, ctx.orgId)))
    .returning({ id: savedFilters.id });
  if (deleted.length === 0) throw new NotFoundError("saved filter");
}
