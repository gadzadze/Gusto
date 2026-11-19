// Saved filter views for the supplier product list. A view is stored as the canonical query string of the list's
// own filters. Building it from a whitelist (and rebuilding it when it is read back) means a stored view can never
// carry anything but those filters, whatever the browser sent.

export const SAVED_FILTER_LISTS = ["products"] as const;
export type SavedFilterList = (typeof SAVED_FILTER_LISTS)[number];

export const MAX_SAVED_FILTERS = 20;
export const MAX_FILTER_NAME = 40;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProductFilterParams = { q?: string; category?: string; status?: string; stock?: string };

/** The canonical query string ("" when nothing is filtered): fixed order, only valid, non-default values. */
export function canonicalProductQuery(params: ProductFilterParams): string {
  const out = new URLSearchParams();
  const q = (params.q ?? "").trim().slice(0, 100);
  if (q) out.set("q", q);
  if (params.category && UUID.test(params.category)) out.set("category", params.category.toLowerCase());
  if (params.status === "active" || params.status === "inactive") out.set("status", params.status);
  if (params.stock === "low") out.set("stock", "low");
  return out.toString();
}

/** Canonicalises a stored or submitted query string for the given list. */
export function canonicalQuery(list: SavedFilterList, query: string): string {
  const p = new URLSearchParams(query);
  return canonicalProductQuery({ q: p.get("q") ?? "", category: p.get("category") ?? "", status: p.get("status") ?? "", stock: p.get("stock") ?? "" });
}

export function cleanFilterName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_FILTER_NAME);
}
