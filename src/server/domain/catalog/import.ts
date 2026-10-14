import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import {
  missingRequiredFields,
  parseImportRow,
  type ImportField,
  type ImportMapping,
  type RawSheet,
  type RowError,
} from "@/lib/catalog/import";
import type { ProductValues } from "@/lib/validation/product";
import { getDb } from "@/server/db/client";
import { categories, products, supplierSettings } from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";
import { StateError } from "@/server/domain/errors";
import { assertCatalogWritable, productSearchText } from "./products";

export type ImportRowResult =
  | { rowNumber: number; action: "create" | "update"; name: string; sku: string | null }
  | { rowNumber: number; action: "error"; name: string; errors: RowError[] };

export type ImportAnalysis = {
  rows: ImportRowResult[];
  counts: { create: number; update: number; error: number };
};

export type ImportCommitResult = { created: number; updated: number; skipped: number };

export type ImportError = "missing_columns" | "has_errors" | "nothing_to_import";

type Planned = { rowNumber: number; values: ProductValues; existingId: string | null };

async function plan(ctx: OrgCtx, sheet: RawSheet, mapping: ImportMapping) {
  const missing = missingRequiredFields(mapping);
  if (missing.length > 0) throw new StateError<ImportError>("missing_columns");

  const db = getDb();
  const activeCategories = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.isArchived, false));
  const categoryIdByName = new Map(activeCategories.map((c) => [c.name.trim().toLowerCase(), c.id]));

  const results: ImportRowResult[] = [];
  const planned: Planned[] = [];
  const seenSkus = new Set<string>();
  const parsedRows = sheet.rows.map((row, i) => ({
    rowNumber: i + 2, // 1-based, after the header row, as the spreadsheet shows it
    parsed: parseImportRow(row, sheet.headers, mapping, categoryIdByName),
  }));

  const skus = parsedRows.flatMap((r) => (r.parsed.ok && r.parsed.values.sku ? [r.parsed.values.sku] : []));
  const existing = skus.length
    ? await db
        .select({ id: products.id, sku: products.sku })
        .from(products)
        .where(and(eq(products.supplierOrgId, ctx.orgId), inArray(products.sku, skus)))
    : [];
  const existingBySku = new Map(existing.map((p) => [p.sku as string, p.id]));

  for (const { rowNumber, parsed } of parsedRows) {
    if (!parsed.ok) {
      results.push({ rowNumber, action: "error", name: parsed.name, errors: parsed.errors });
      continue;
    }
    const sku = parsed.values.sku;
    if (sku) {
      if (seenSkus.has(sku)) {
        results.push({
          rowNumber,
          action: "error",
          name: parsed.values.name,
          errors: [{ field: "sku" satisfies ImportField, key: "duplicate_sku_in_file" }],
        });
        continue;
      }
      seenSkus.add(sku);
    }
    const existingId = sku ? (existingBySku.get(sku) ?? null) : null;
    planned.push({ rowNumber, values: parsed.values, existingId });
    results.push({ rowNumber, action: existingId ? "update" : "create", name: parsed.values.name, sku });
  }

  const counts = { create: 0, update: 0, error: 0 };
  for (const r of results) counts[r.action] += 1;
  return { analysis: { rows: results, counts }, planned };
}

/** Dry run for the preview: what each row would do, and why bad rows fail. */
export async function analyzeImport(ctx: OrgCtx, sheet: RawSheet, mapping: ImportMapping): Promise<ImportAnalysis> {
  assertCatalogWritable(ctx);
  return (await plan(ctx, sheet, mapping)).analysis;
}

/**
 * Applies an import in one transaction. Rows are matched to existing
 * products by SKU (update) or created. With mode "all", any invalid row
 * aborts the whole import; "valid_only" skips invalid rows explicitly.
 * Re-validates everything — the preview the browser showed is not trusted.
 */
export async function commitImport(
  ctx: OrgCtx,
  sheet: RawSheet,
  mapping: ImportMapping,
  mode: "all" | "valid_only",
): Promise<ImportCommitResult> {
  assertCatalogWritable(ctx);
  const { analysis, planned } = await plan(ctx, sheet, mapping);
  if (mode === "all" && analysis.counts.error > 0) throw new StateError<ImportError>("has_errors");
  if (planned.length === 0) throw new StateError<ImportError>("nothing_to_import");

  return getDb().transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    const toInsert: (typeof products.$inferInsert)[] = [];

    for (const { values, existingId } of planned) {
      const columns = {
        name: values.name,
        description: values.description,
        brand: values.brand,
        sku: values.sku,
        categoryId: values.categoryId,
        unit: values.unit,
        packDescription: values.packDescription,
        basePriceMinor: values.basePrice,
        vatRateBp: values.vatRate,
        minQtyMilli: values.minQty,
        qtyStepMilli: values.qtyStep,
        searchText: productSearchText(values),
      };
      if (existingId) {
        const rows = await tx
          .update(products)
          .set(columns)
          .where(and(eq(products.id, existingId), eq(products.supplierOrgId, ctx.orgId)))
          .returning({ id: products.id });
        updated += rows.length;
      } else {
        toInsert.push({ supplierOrgId: ctx.orgId, ...columns });
      }
    }
    for (let i = 0; i < toInsert.length; i += 500) {
      const batch = toInsert.slice(i, i + 500);
      await tx.insert(products).values(batch);
      created += batch.length;
    }

    await tx
      .update(supplierSettings)
      .set({ importMapping: mapping as Record<string, string> })
      .where(eq(supplierSettings.organizationId, ctx.orgId));

    return { created, updated, skipped: analysis.counts.error };
  });
}

export async function getSavedImportMapping(ctx: OrgCtx): Promise<ImportMapping | null> {
  assertCatalogWritable(ctx);
  const [row] = await getDb()
    .select({ mapping: supplierSettings.importMapping })
    .from(supplierSettings)
    .where(eq(supplierSettings.organizationId, ctx.orgId));
  return (row?.mapping as ImportMapping | null) ?? null;
}
