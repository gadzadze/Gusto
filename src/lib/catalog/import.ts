import { z } from "zod";
import { parseUnit } from "@/lib/catalog/units";
import { parseMoneyInput } from "@/lib/money";
import { toValidationKey } from "@/lib/validation/form-errors";
import { NEW_PRODUCT_DEFAULTS, productSchema, type ProductInput, type ProductValues } from "@/lib/validation/product";

// Catalog import, the pure half: turning spreadsheet cells into validated
// product values. The browser parses the file (CSV/XLSX) into a RawSheet and
// shows a preview; the server re-runs all of this on commit and trusts none
// of the client's results.

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_COLUMNS = 40;

export const IMPORT_FIELDS = [
  "name",
  "sku",
  "category",
  "unit",
  "price",
  "vatRate",
  "minQty",
  "qtyStep",
  "packDescription",
  "brand",
  "description",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const REQUIRED_IMPORT_FIELDS: readonly ImportField[] = ["name", "category", "unit", "price"];

/** Which column header feeds which field. */
export type ImportMapping = Partial<Record<ImportField, string>>;

export type RawSheet = { headers: string[]; rows: string[][] };

export const rawSheetSchema = z.object({
  headers: z.array(z.string().max(200)).min(1).max(MAX_IMPORT_COLUMNS),
  rows: z.array(z.array(z.string().max(4000)).max(MAX_IMPORT_COLUMNS)).max(MAX_IMPORT_ROWS),
});

export const importMappingSchema = z
  .object(Object.fromEntries(IMPORT_FIELDS.map((f) => [f, z.string().max(200).optional()])))
  .transform((m) => m as ImportMapping);

// Header spellings recognized automatically, normalized (lowercase, no
// punctuation/spaces). Includes the downloadable template's Georgian headers.
const HEADER_ALIASES: Record<ImportField, string[]> = {
  name: ["სახელი", "დასახელება", "პროდუქტი", "name", "product", "productname"],
  sku: ["sku", "კოდი", "არტიკული", "artikuli", "code"],
  category: ["კატეგორია", "category"],
  unit: ["ერთეული", "unit", "uom"],
  price: ["ფასი", "price", "ფასი₾", "ფასილარი"],
  vatRate: ["დღგ", "დღგ%", "vat", "vat%", "vatrate"],
  minQty: ["მინრაოდენობა", "მინიმალურირაოდენობა", "minqty", "minquantity", "min"],
  qtyStep: ["ბიჯი", "step", "qtystep", "increment"],
  packDescription: ["შეფუთვა", "pack", "package", "packaging"],
  brand: ["ბრენდი", "brand"],
  description: ["აღწერა", "description"],
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[\s.,:;()\-_/]+/g, "");
}

/**
 * Pre-selects a column for each field: the supplier's last mapping where that
 * header still exists, otherwise a recognized header name.
 */
export function guessMapping(headers: string[], previous?: ImportMapping | null): ImportMapping {
  const mapping: ImportMapping = {};
  const available = new Set(headers);
  for (const field of IMPORT_FIELDS) {
    const prev = previous?.[field];
    if (prev && available.has(prev)) {
      mapping[field] = prev;
      continue;
    }
    const match = headers.find((h) => HEADER_ALIASES[field].includes(normalizeHeader(h)));
    if (match) mapping[field] = match;
  }
  return mapping;
}

/** Spreadsheet cells → trimmed strings; first non-empty row is the header; empty rows dropped. */
export function sheetFromCells(cells: readonly (readonly unknown[])[]): RawSheet {
  const toText = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).trim();
  };
  const rows = cells.map((row) => row.map(toText)).filter((row) => row.some((c) => c !== ""));
  const [headers = [], ...data] = rows;
  return { headers, rows: data };
}

export type RowErrorKey =
  | ReturnType<typeof toValidationKey>
  | "invalid_unit"
  | "unknown_category"
  | "duplicate_sku_in_file";

export type RowError = { field: ImportField; key: RowErrorKey };

export type ParsedRow =
  | { ok: true; values: ProductValues }
  | { ok: false; errors: RowError[]; name: string };

const SCHEMA_TO_IMPORT_FIELD: Record<string, ImportField> = {
  name: "name",
  sku: "sku",
  categoryId: "category",
  unit: "unit",
  basePrice: "price",
  vatRate: "vatRate",
  minQty: "minQty",
  qtyStep: "qtyStep",
  packDescription: "packDescription",
  brand: "brand",
  description: "description",
};

/**
 * Validates one row. `categoryIdByName` maps lowercased category names to
 * IDs (active categories only). Unmapped optional columns take the same
 * defaults as a new product form.
 */
export function parseImportRow(
  row: readonly string[],
  headers: readonly string[],
  mapping: ImportMapping,
  categoryIdByName: ReadonlyMap<string, string>,
): ParsedRow {
  const cell = (field: ImportField): string => {
    const header = mapping[field];
    if (!header) return "";
    const index = headers.indexOf(header);
    return index >= 0 ? (row[index] ?? "").trim() : "";
  };
  const orDefault = (field: ImportField, fallback: string) => cell(field) || fallback;

  const errors: RowError[] = [];
  const unitText = cell("unit");
  const unit = parseUnit(unitText);
  if (!unit) errors.push({ field: "unit", key: unitText ? "invalid_unit" : "required" });

  const categoryText = cell("category");
  const categoryId = categoryIdByName.get(categoryText.toLowerCase());
  if (!categoryId) errors.push({ field: "category", key: categoryText ? "unknown_category" : "required" });

  const input: ProductInput = {
    name: cell("name"),
    sku: cell("sku"),
    brand: cell("brand"),
    description: cell("description"),
    packDescription: cell("packDescription"),
    categoryId: categoryId ?? "",
    unit: unit ?? "piece",
    basePrice: cell("price"),
    vatRate: orDefault("vatRate", NEW_PRODUCT_DEFAULTS.vatRate),
    minQty: orDefault("minQty", NEW_PRODUCT_DEFAULTS.minQty),
    qtyStep: orDefault("qtyStep", NEW_PRODUCT_DEFAULTS.qtyStep),
  };

  const parsed = productSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = SCHEMA_TO_IMPORT_FIELD[String(issue.path[0])];
      if (!field || errors.some((e) => e.field === field)) continue;
      errors.push({ field, key: toValidationKey(issue.message) });
    }
  }
  if (errors.length > 0 || !parsed.success) return { ok: false, errors, name: input.name };
  return { ok: true, values: parsed.data };
}

/** Required fields that have no column assigned. */
export function missingRequiredFields(mapping: ImportMapping): ImportField[] {
  return REQUIRED_IMPORT_FIELDS.filter((f) => !mapping[f]);
}

// ── Price list overrides: SKU + price only ──────────────────────────────────

export const PRICE_IMPORT_FIELDS = ["sku", "price"] as const;
export type PriceImportField = (typeof PRICE_IMPORT_FIELDS)[number];
export type PriceImportMapping = Partial<Record<PriceImportField, string>>;

export const priceImportMappingSchema = z.object({
  sku: z.string().max(200).optional(),
  price: z.string().max(200).optional(),
});

export function guessPriceMapping(headers: string[]): PriceImportMapping {
  const all = guessMapping(headers);
  return { sku: all.sku, price: all.price };
}

export type PriceRow =
  | { ok: true; sku: string; priceMinor: number }
  | { ok: false; sku: string; errors: { field: PriceImportField; key: "required" | "invalid_price" }[] };

export function parsePriceRow(row: readonly string[], headers: readonly string[], mapping: PriceImportMapping): PriceRow {
  const cell = (field: PriceImportField) => {
    const header = mapping[field];
    const index = header ? headers.indexOf(header) : -1;
    return index >= 0 ? (row[index] ?? "").trim() : "";
  };
  const sku = cell("sku");
  const priceText = cell("price");
  const errors: { field: PriceImportField; key: "required" | "invalid_price" }[] = [];
  if (!sku) errors.push({ field: "sku", key: "required" });
  const priceMinor = priceText ? parseMoneyInput(priceText) : null;
  if (!priceText) errors.push({ field: "price", key: "required" });
  else if (priceMinor === null) errors.push({ field: "price", key: "invalid_price" });
  if (errors.length > 0 || priceMinor === null) return { ok: false, sku, errors };
  return { ok: true, sku, priceMinor };
}
