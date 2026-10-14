"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireAdmin } from "@/server/auth/guards";
import {
  categoryNameSchema,
  createCategory,
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
