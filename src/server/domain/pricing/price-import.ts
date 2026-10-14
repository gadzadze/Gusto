import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import {
  parsePriceRow,
  type PriceImportField,
  type PriceImportMapping,
  type RawSheet,
} from "@/lib/catalog/import";
import { getDb } from "@/server/db/client";
import { products } from "@/server/db/schema";
import { assertCatalogWritable } from "@/server/domain/catalog/products";
import type { OrgCtx } from "@/server/domain/context";
import { StateError } from "@/server/domain/errors";
import { getPriceList, setPriceOverrides } from "./price-lists";

export type PriceRowError = { field: PriceImportField; key: "required" | "invalid_price" | "unknown_sku" | "duplicate_sku_in_file" };

export type PriceImportRow =
  | { rowNumber: number; action: "set"; sku: string; name: string; basePriceMinor: number; priceMinor: number }
  | { rowNumber: number; action: "error"; sku: string; errors: PriceRowError[] };

export type PriceImportAnalysis = { rows: PriceImportRow[]; counts: { set: number; error: number } };
export type PriceImportError = "missing_columns" | "has_errors" | "nothing_to_import";

async function plan(ctx: OrgCtx, priceListId: string, sheet: RawSheet, mapping: PriceImportMapping) {
  assertCatalogWritable(ctx);
  await getPriceList(ctx, priceListId);
  if (!mapping.sku || !mapping.price) throw new StateError<PriceImportError>("missing_columns");

  const parsed = sheet.rows.map((row, i) => ({ rowNumber: i + 2, row: parsePriceRow(row, sheet.headers, mapping) }));
  const skus = [...new Set(parsed.flatMap((p) => (p.row.ok ? [p.row.sku] : [])))];
  const found = skus.length
    ? await getDb()
        .select({ id: products.id, sku: products.sku, name: products.name, basePriceMinor: products.basePriceMinor })
        .from(products)
        .where(and(eq(products.supplierOrgId, ctx.orgId), inArray(products.sku, skus)))
    : [];
  const bySku = new Map(found.map((p) => [p.sku as string, p]));

  const seen = new Set<string>();
  const rows: PriceImportRow[] = [];
  const changes: { productId: string; priceMinor: number }[] = [];
  for (const { rowNumber, row } of parsed) {
    if (!row.ok) {
      rows.push({ rowNumber, action: "error", sku: row.sku, errors: row.errors });
      continue;
    }
    const product = bySku.get(row.sku);
    if (!product) {
      rows.push({ rowNumber, action: "error", sku: row.sku, errors: [{ field: "sku", key: "unknown_sku" }] });
      continue;
    }
    if (seen.has(row.sku)) {
      rows.push({ rowNumber, action: "error", sku: row.sku, errors: [{ field: "sku", key: "duplicate_sku_in_file" }] });
      continue;
    }
    seen.add(row.sku);
    rows.push({ rowNumber, action: "set", sku: row.sku, name: product.name, basePriceMinor: product.basePriceMinor, priceMinor: row.priceMinor });
    changes.push({ productId: product.id, priceMinor: row.priceMinor });
  }
  const counts = { set: changes.length, error: rows.length - changes.length };
  return { analysis: { rows, counts }, changes };
}

export async function analyzePriceImport(
  ctx: OrgCtx,
  priceListId: string,
  sheet: RawSheet,
  mapping: PriceImportMapping,
): Promise<PriceImportAnalysis> {
  return (await plan(ctx, priceListId, sheet, mapping)).analysis;
}

/** Re-validates and applies; "all" refuses if any row is bad. One transaction. */
export async function commitPriceImport(
  ctx: OrgCtx,
  priceListId: string,
  sheet: RawSheet,
  mapping: PriceImportMapping,
  mode: "all" | "valid_only",
): Promise<{ updated: number; skipped: number }> {
  const { analysis, changes } = await plan(ctx, priceListId, sheet, mapping);
  if (mode === "all" && analysis.counts.error > 0) throw new StateError<PriceImportError>("has_errors");
  if (changes.length === 0) throw new StateError<PriceImportError>("nothing_to_import");
  await setPriceOverrides(ctx, priceListId, changes);
  return { updated: changes.length, skipped: analysis.counts.error };
}
