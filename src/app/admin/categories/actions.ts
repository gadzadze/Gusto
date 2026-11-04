"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireAdmin } from "@/server/auth/guards";
import { STANDARD_CATEGORIES } from "@/lib/catalog/categories-standard";
import {
  categoryNameSchema,
  createCategory,
  createMissingCategories,
  type CreateMissingResult,
  moveCategory,
  renameCategory,
  setCategoryArchived,
} from "@/server/domain/catalog/categories";

type CategoryError = "name_taken" | "required" | "too_long";
type Result = { ok: true } | ActionError<CategoryError>;

function nameError(raw: unknown): Result | null {
  const parsed = categoryNameSchema.safeParse(raw);
  if (parsed.success) return null;
  return { ok: false, error: parsed.error.issues[0]?.message === "too_long" ? "too_long" : "required" };
}

export async function createCategoryAction(name: string): Promise<Result> {
  const ctx = await requireAdmin();
  const invalid = nameError(name);
  if (invalid) return invalid;
  return runAction<Result, CategoryError>("createCategory", async () => {
    await createCategory(ctx, name);
    refresh();
    return { ok: true };
  });
}

export async function renameCategoryAction(id: string, name: string): Promise<Result> {
  const ctx = await requireAdmin();
  const invalid = nameError(name);
  if (invalid) return invalid;
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  return runAction<Result, CategoryError>("renameCategory", async () => {
    await renameCategory(ctx, id, name);
    refresh();
    return { ok: true };
  });
}

export async function moveCategoryAction(id: string, direction: "up" | "down"): Promise<Result> {
  const ctx = await requireAdmin();
  if (!z.uuid().safeParse(id).success || (direction !== "up" && direction !== "down")) {
    return { ok: false, error: "invalid" };
  }
  return runAction<Result, CategoryError>("moveCategory", async () => {
    await moveCategory(ctx, id, direction);
    refresh();
    return { ok: true };
  });
}

export async function setCategoryArchivedAction(id: string, archived: boolean): Promise<Result> {
  const ctx = await requireAdmin();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  return runAction<Result, CategoryError>("setCategoryArchived", async () => {
    await setCategoryArchived(ctx, id, archived === true);
    refresh();
    return { ok: true };
  });
}

/** Creates the categories from a product file that Gusto does not have yet. */
export async function createCategoriesFromFileAction(names: unknown): Promise<({ ok: true } & CreateMissingResult) | ActionError<CategoryError>> {
  const ctx = await requireAdmin();
  const parsed = z.array(z.string().max(200)).min(1).max(100).safeParse(names);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true } & CreateMissingResult, CategoryError>("createCategoriesFromFile", async () => {
    const result = await createMissingCategories(ctx, parsed.data);
    refresh();
    return { ok: true, ...result };
  });
}

/** Adds the standard HoReCa categories that are not there yet (existing ones are left alone). */
export async function createStandardCategoriesAction(): Promise<({ ok: true } & CreateMissingResult) | ActionError<CategoryError>> {
  const ctx = await requireAdmin();
  return runAction<{ ok: true } & CreateMissingResult, CategoryError>("createStandardCategories", async () => {
    const result = await createMissingCategories(ctx, STANDARD_CATEGORIES.map((c) => c.name));
    refresh();
    return { ok: true, ...result };
  });
}
