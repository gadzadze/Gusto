// Units a product can be sold in. Labels live in messages (`units.*`).
export const PRODUCT_UNITS = ["piece", "kg", "g", "l", "ml", "box", "pack", "case", "bottle"] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

// What people actually type in a price list column, mapped to a unit.
// Lowercased, trimmed, trailing dots removed before lookup.
const UNIT_ALIASES: Record<string, ProductUnit> = {
  piece: "piece", pc: "piece", pcs: "piece", ცალი: "piece", ც: "piece",
  kg: "kg", კგ: "kg", კილოგრამი: "kg",
  g: "g", gr: "g", გ: "g", გრ: "g", გრამი: "g",
  l: "l", lt: "l", ლ: "l", ლიტრი: "l",
  ml: "ml", მლ: "ml", მილილიტრი: "ml",
  box: "box", ყუთი: "box",
  pack: "pack", შეკვრა: "pack", პაკეტი: "pack",
  case: "case", კოლოფი: "case", ბლოკი: "case",
  bottle: "bottle", ბოთლი: "bottle",
};

export function parseUnit(input: string): ProductUnit | null {
  const key = input.trim().toLowerCase().replace(/\.+$/, "");
  return UNIT_ALIASES[key] ?? null;
}
