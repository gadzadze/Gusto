// Units a product can be sold in, which for a distributor are also its packaging
// (bottle, box, case, keg, pallet ...). Labels live in messages (`units.*`).
export const PRODUCT_UNITS = [
  "piece", "kg", "g", "l", "ml",
  "box", "pack", "case", "bottle",
  "jar", "bag", "sack", "keg", "pallet", "bunch", "roll", "bucket",
] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

// What people actually type in a price list column, mapped to a unit. Keys are
// already normalised (see normalizeUnitKey), so write them lowercase, no spaces.
const UNIT_ALIASES: Record<string, ProductUnit> = {
  // piece
  piece: "piece", pieces: "piece", pc: "piece", pcs: "piece", unit: "piece", units: "piece", each: "piece", ea: "piece",
  ცალი: "piece", ც: "piece", ცალ: "piece", ერთეული: "piece", шт: "piece",
  // weight
  kg: "kg", kgs: "kg", kilo: "kg", kilogram: "kg", კგ: "kg", კილოგრამი: "kg", კილო: "kg", кг: "kg",
  g: "g", gr: "g", gram: "g", grams: "g", გ: "g", გრ: "g", გრამი: "g", г: "g",
  // volume
  l: "l", lt: "l", ltr: "l", liter: "l", litre: "l", ლ: "l", ლიტრი: "l", ლტ: "l", л: "l",
  ml: "ml", milliliter: "ml", millilitre: "ml", მლ: "ml", მილილიტრი: "ml", мл: "ml",
  // packaging
  box: "box", boxes: "box", carton: "box", ctn: "box", bx: "box", ყუთი: "box", ყუთ: "box", коробка: "box", ящик: "box",
  pack: "pack", packs: "pack", package: "pack", packet: "pack", pkg: "pack", pk: "pack", pck: "pack", შეკვრა: "pack", პაკეტი: "pack", შეფუთვა: "pack", уп: "pack", упаковка: "pack",
  case: "case", cases: "case", cs: "case", კოლოფი: "case", ბლოკი: "case", блок: "case",
  bottle: "bottle", bottles: "bottle", btl: "bottle", bot: "bottle", ბოთლი: "bottle", ბოთ: "bottle", бутылка: "bottle", бут: "bottle",
  jar: "jar", jars: "jar", can: "jar", cans: "jar", tin: "jar", ქილა: "jar", ბანკა: "jar", банка: "jar",
  bag: "bag", bags: "bag", პარკი: "bag", пакет: "bag",
  sack: "sack", sacks: "sack", ტომარა: "sack", ტომარ: "sack", мешок: "sack",
  keg: "keg", kegs: "keg", barrel: "keg", კასრი: "keg", бочка: "keg",
  pallet: "pallet", pallets: "pallet", pal: "pallet", პალეტა: "pallet", პალეტი: "pallet", паллета: "pallet",
  bunch: "bunch", bunches: "bunch", კონა: "bunch", пучок: "bunch",
  roll: "roll", rolls: "roll", რულონი: "roll", рулон: "roll",
  bucket: "bucket", buckets: "bucket", pail: "bucket", ვედრო: "bucket", ведро: "bucket",
};

/** Lowercase, and drop spaces, dots, brackets and slashes: "Pcs.", "ც.", "Piece(s)" all find their entry. */
export function normalizeUnitKey(input: string): string {
  return input.trim().toLowerCase().replace(/\(s\)/g, "s").replace(/[\s.,;:()\[\]/\\-]+/g, "");
}

export function parseUnit(input: string): ProductUnit | null {
  return UNIT_ALIASES[normalizeUnitKey(input)] ?? null;
}

/** Every spelling that maps to each unit, for the import guide. */
export function unitAliasTable(): Record<ProductUnit, string[]> {
  const table = Object.fromEntries(PRODUCT_UNITS.map((u) => [u, [] as string[]])) as Record<ProductUnit, string[]>;
  for (const [alias, unit] of Object.entries(UNIT_ALIASES)) table[unit].push(alias);
  return table;
}
