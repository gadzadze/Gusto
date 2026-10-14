"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { importMappingSchema, rawSheetSchema } from "@/lib/catalog/import";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireSupplier } from "@/server/auth/guards";
import {
  analyzeImport,
  commitImport,
  type ImportAnalysis,
  type ImportCommitResult,
  type ImportError,
} from "@/server/domain/catalog/import";
import type { CatalogWriteError } from "@/server/domain/catalog/products";

const payloadSchema = z.object({ sheet: rawSheetSchema, mapping: importMappingSchema });

type ImportActionError = ActionError<ImportError | CatalogWriteError>;

export async function analyzeImportAction(raw: unknown): Promise<{ ok: true; analysis: ImportAnalysis } | ImportActionError> {
  const ctx = await requireSupplier();
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true; analysis: ImportAnalysis }, ImportError | CatalogWriteError>("analyzeImport", async () => ({
    ok: true,
    analysis: await analyzeImport(ctx, parsed.data.sheet, parsed.data.mapping),
  }));
}

export async function commitImportAction(raw: unknown): Promise<{ ok: true; result: ImportCommitResult } | ImportActionError> {
  const ctx = await requireSupplier();
  const parsed = payloadSchema.extend({ mode: z.enum(["all", "valid_only"]) }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true; result: ImportCommitResult }, ImportError | CatalogWriteError>("commitImport", async () => {
    const result = await commitImport(ctx, parsed.data.sheet, parsed.data.mapping, parsed.data.mode);
    refresh();
    return { ok: true, result };
  });
}
