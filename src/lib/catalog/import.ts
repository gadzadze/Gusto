import { z } from "zod";
import { generateSku } from "@/lib/catalog/auto-sku";
import { guessCategoryFromName } from "@/lib/catalog/category-guess";
import { normalizeCategoryKey } from "@/lib/catalog/categories-standard";
import { PRODUCT_UNITS, parseUnit, type ProductUnit } from "@/lib/catalog/units";
import { cleanAmountText, parseMoneyInput } from "@/lib/money";
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
  "barcode",
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
  name: ["სახელი", "დასახელება", "პროდუქტი", "პროდუქტისდასახელება", "პროდუქციისდასახელება", "საქონელი", "საქონლისდასახელება", "name", "product", "productname", "item", "itemname", "goods", "наименование", "товар", "название"],
  sku: ["sku", "კოდი", "პროდუქტისკოდი", "არტიკული", "artikuli", "code", "productcode", "itemcode", "article", "артикул", "код"],
  category: ["კატეგორია", "ჯგუფი", "პროდუქტისჯგუფი", "category", "group", "productgroup", "категория", "группа"],
  unit: ["ერთეული", "ზომისერთეული", "განზომილება", "unit", "uom", "unitofmeasure", "measure", "ед", "единица"],
  price: ["ფასი", "ფასიდღგთი", "ფასიდღგსგარეშე", "ღირებულება", "price", "unitprice", "cost", "ფასი₾", "ფასილარი", "ფასიგელი", "цена"],
  vatRate: ["დღგ", "დღგ%", "vat", "vat%", "vatrate"],
  minQty: ["მინრაოდენობა", "მინიმალურირაოდენობა", "minqty", "minquantity", "min"],
  qtyStep: ["ბიჯი", "step", "qtystep", "increment"],
  packDescription: ["შეფუთვა", "pack", "package", "packaging"],
  brand: ["ბრენდი", "brand"],
  barcode: ["შტრიხკოდი", "ბარკოდი", "barcode", "ean", "ean13", "gtin", "upc", "штрихкод"],
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
  | "category_not_guessed"
  | "duplicate_sku_in_file";

export type RowError = { field: ImportField; key: RowErrorKey };

/**
 * What to do when a file lacks something Gusto needs. Each option only fills a
 * gap: a cell that has text is never replaced (a misspelt category stays an
 * error rather than being silently moved to another).
 */
export type ImportOptions = {
  /** Category for rows whose category cell is empty (or whose column is not mapped). */
  defaultCategoryId?: string;
  /** Guess the category from the product name for such rows (needs the standard category to exist). */
  guessCategory?: boolean;
  /** Unit for rows whose unit cell is empty (or whose column is not mapped). */
  defaultUnit?: ProductUnit;
  /** Make a product code from the name for rows with no code. */
  autoSku?: boolean;
};

export const importOptionsSchema = z
  .object({
    defaultCategoryId: z.uuid().optional(),
    guessCategory: z.boolean().optional(),
    defaultUnit: z.enum(PRODUCT_UNITS).optional(),
    autoSku: z.boolean().optional(),
  })
  .default({});

/** Where a value that was not in the file came from, shown in the preview. */
export type RowMeta = { categoryId: string; categorySource: "file" | "default" | "guess"; skuGenerated: boolean };

export type ParsedRow =
  | { ok: true; values: ProductValues; meta: RowMeta }
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
  barcode: "barcode",
  description: "description",
};

/**
 * Validates one row. `categoryIdByName` is `buildCategoryLookup(...)` over the
 * active categories (normalised names and standard aliases to IDs). Unmapped optional columns take the same
 * defaults as a new product form.
 */
export function parseImportRow(
  row: readonly string[],
  headers: readonly string[],
  mapping: ImportMapping,
  categoryIdByName: ReadonlyMap<string, string>,
  options: ImportOptions = {},
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
  const unit = unitText ? parseUnit(unitText) : (options.defaultUnit ?? null);
  if (!unit) errors.push({ field: "unit", key: unitText ? "invalid_unit" : "required" });

  const categoryText = cell("category");
  let categoryId = categoryIdByName.get(normalizeCategoryKey(categoryText));
  let categorySource: RowMeta["categorySource"] = "file";
  if (!categoryText) {
    // Nothing in the file: fall back to what the supplier chose, and only then.
    if (options.defaultCategoryId) {
      categoryId = options.defaultCategoryId;
      categorySource = "default";
    } else if (options.guessCategory) {
      const guessed = guessCategoryFromName(cell("name"));
      categoryId = guessed ? categoryIdByName.get(normalizeCategoryKey(guessed)) : undefined;
      categorySource = "guess";
      if (!categoryId) errors.push({ field: "category", key: "category_not_guessed" });
    }
  }
  if (!categoryId && !errors.some((e) => e.field === "category")) {
    errors.push({ field: "category", key: categoryText ? "unknown_category" : "required" });
  }
  const skuText = cell("sku");
  // A barcode is a stable code too, so it stands in for a missing product code.
  const sku = skuText || cell("barcode").replace(/\s+/g, "") || (options.autoSku && cell("name") ? generateSku(cell("name")) : "");

  const input: ProductInput = {
    name: cell("name"),
    sku,
    brand: cell("brand"),
    barcode: cell("barcode"),
    description: cell("description"),
    packDescription: cell("packDescription"),
    categoryId: categoryId ?? "",
    unit: unit ?? "piece",
    basePrice: cleanAmountText(cell("price")),
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
  return { ok: true, values: parsed.data, meta: { categoryId: categoryId as string, categorySource, skuGenerated: !skuText && Boolean(sku) } };
}

/** Required fields that have no column assigned. */
export function missingRequiredFields(mapping: ImportMapping, options: ImportOptions = {}): ImportField[] {
  return REQUIRED_IMPORT_FIELDS.filter((f) => {
    if (mapping[f]) return false;
    // A fallback the supplier chose stands in for a missing column.
    if (f === "category") return !(options.defaultCategoryId || options.guessCategory);
    if (f === "unit") return !options.defaultUnit;
    return true;
  });
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

// ── Categories named in a file ──────────────────────────────────────────────

export const MAX_CATEGORIES_FROM_FILE = 100;

/**
 * The distinct category names a product file uses (first spelling wins,
 * case-insensitive), from the column that is, or looks like, the category one.
 * `column` overrides the guess; null if there is no category column at all.
 */
export function categoryNamesInSheet(sheet: RawSheet, column?: string): { column: string; names: string[] } | null {
  const header = column ?? guessMapping(sheet.headers).category;
  const index = header ? sheet.headers.indexOf(header) : -1;
  if (!header || index < 0) return null;
  const seen = new Map<string, string>();
  for (const row of sheet.rows) {
    const name = (row[index] ?? "").trim();
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return { column: header, names: [...seen.values()] };
}
