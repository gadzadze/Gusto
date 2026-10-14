import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { categories, products, type Category } from "@/server/db/schema";
import { writeAudit } from "@/server/domain/audit";
import { assertAdmin, type AdminCtx } from "@/server/domain/context";
import { ConflictError, NotFoundError, isUniqueViolation } from "@/server/domain/errors";

export const categoryNameSchema = z.string().trim().min(1, "required").max(80, "too_long");

/** Categories a supplier can pick for a product, in display order. */
export async function listActiveCategories(): Promise<Pick<Category, "id" | "name">[]> {
  return getDb()
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.isArchived, false))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

export type CategoryWithUsage = Category & { productCount: number };

export async function listAllCategories(ctx: AdminCtx): Promise<CategoryWithUsage[]> {
  assertAdmin(ctx);
  return getDb()
    .select({
      id: categories.id,
      name: categories.name,
      sortOrder: categories.sortOrder,
      isArchived: categories.isArchived,
      createdAt: categories.createdAt,
      updatedAt: categories.updatedAt,
      productCount: sql<number>`(select count(*)::int from ${products} where ${products.categoryId} = ${categories.id})`,
    })
    .from(categories)
    .orderBy(asc(categories.isArchived), asc(categories.sortOrder), asc(categories.name));
}

export async function createCategory(ctx: AdminCtx, rawName: string): Promise<string> {
  assertAdmin(ctx);
  const name = categoryNameSchema.parse(rawName);
  try {
    return await getDb().transaction(async (tx) => {
      const [last] = await tx
        .select({ sortOrder: categories.sortOrder })
        .from(categories)
        .orderBy(desc(categories.sortOrder))
        .limit(1);
      const [row] = await tx
        .insert(categories)
        .values({ name, sortOrder: (last?.sortOrder ?? 0) + 10 })
        .returning({ id: categories.id });
      await writeAudit(tx, {
        actorUserId: ctx.userId,
        action: "category.created",
        targetType: "category",
        targetId: row.id,
        data: { name },
      });
      return row.id;
    });
  } catch (error) {
    if (isUniqueViolation(error, "categories_name_key")) throw new ConflictError("name_taken");
    throw error;
  }
}

export async function renameCategory(ctx: AdminCtx, id: string, rawName: string): Promise<void> {
  assertAdmin(ctx);
  const name = categoryNameSchema.parse(rawName);
  try {
    await getDb().transaction(async (tx) => {
      const [before] = await tx
        .select({ name: categories.name })
        .from(categories)
        .where(eq(categories.id, id))
        .for("update");
      if (!before) throw new NotFoundError("category");
      if (before.name === name) return;
      await tx.update(categories).set({ name }).where(eq(categories.id, id));
      await writeAudit(tx, {
        actorUserId: ctx.userId,
        action: "category.renamed",
        targetType: "category",
        targetId: id,
        data: { before: before.name, after: name },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, "categories_name_key")) throw new ConflictError("name_taken");
    throw error;
  }
}

/** Swaps a category with its neighbour in display order. */
export async function moveCategory(ctx: AdminCtx, id: string, direction: "up" | "down"): Promise<void> {
  assertAdmin(ctx);
  await getDb().transaction(async (tx) => {
    // Lock the whole list so concurrent moves can't interleave.
    const all = await tx
      .select({ id: categories.id, sortOrder: categories.sortOrder, isArchived: categories.isArchived })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name))
      .for("update");
    const current = all.find((c) => c.id === id);
    if (!current) throw new NotFoundError("category");
    const peers = all.filter((c) => c.isArchived === current.isArchived);
    const index = peers.findIndex((c) => c.id === id);
    const neighbour = peers[direction === "up" ? index - 1 : index + 1];
    if (!neighbour) return;

    // Renumber the group so equal sort orders can't make the swap a no-op.
    const reordered = [...peers];
    reordered.splice(index, 1);
    reordered.splice(direction === "up" ? index - 1 : index + 1, 0, current);
    for (const [i, c] of reordered.entries()) {
      await tx.update(categories).set({ sortOrder: (i + 1) * 10 }).where(eq(categories.id, c.id));
    }
    await writeAudit(tx, {
      actorUserId: ctx.userId,
      action: "category.moved",
      targetType: "category",
      targetId: id,
      data: { direction },
    });
  });
}

export async function setCategoryArchived(ctx: AdminCtx, id: string, archived: boolean): Promise<void> {
  assertAdmin(ctx);
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(categories)
      .set({ isArchived: archived })
      .where(and(eq(categories.id, id), eq(categories.isArchived, !archived)))
      .returning({ id: categories.id });
    if (!row) {
      const [exists] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, id));
      if (!exists) throw new NotFoundError("category");
      return; // already in the requested state
    }
    await writeAudit(tx, {
      actorUserId: ctx.userId,
      action: archived ? "category.archived" : "category.restored",
      targetType: "category",
      targetId: id,
    });
  });
}

