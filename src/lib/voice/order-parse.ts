import { parseUnit, type ProductUnit } from "@/lib/catalog/units";

// Pure helpers for the voice-order experiment: the catalogue text a tester pastes, the instructions and
// response schema sent to the model, and the clean-up of what comes back. No I/O here, so it is unit tested.

export type CatalogItem = { id: string; name: string; unit: string; supplierId?: string; supplierName?: string };
/** What the browser needs to turn the assistant's short ids back into products, and to let the buyer step quantities. */
export type VoiceRef = { productId: string; minMilli: number; stepMilli: number };
export type CatalogSupplier = { id: string; name: string };

export const MAX_CATALOG_LINES = 100;
export const MAX_CATALOG_CHARS = 6000;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;

/**
 * One product per line: `id | name | unit`. A line starting with `@` starts a supplier (`@id | name`) and the products below it
 * belong to that supplier. Blank lines and `#` comments are skipped; bad lines are reported. Product ids are unique across suppliers.
 */
export function parseCatalog(text: string): { items: CatalogItem[]; suppliers: CatalogSupplier[]; badLines: number[] } {
  const items: CatalogItem[] = [];
  const suppliers: CatalogSupplier[] = [];
  const badLines: number[] = [];
  const seen = new Set<string>();
  const seenSuppliers = new Set<string>();
  let current: CatalogSupplier | null = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    if (line.startsWith("@")) {
      const [id, name, ...rest] = line.slice(1).split("|").map((p) => p.trim());
      if (rest.length > 0 || !id || !name || !ID_PATTERN.test(id) || seenSuppliers.has(id)) {
        badLines.push(index + 1);
        return;
      }
      seenSuppliers.add(id);
      current = { id, name: name.slice(0, 80) };
      suppliers.push(current);
      return;
    }
    const parts = line.split("|").map((p) => p.trim());
    const [id, name, unit] = parts;
    if (parts.length !== 3 || !id || !name || !unit || seen.has(id) || !ID_PATTERN.test(id)) {
      badLines.push(index + 1);
      return;
    }
    seen.add(id);
    items.push({ id, name: name.slice(0, 120), unit: unit.slice(0, 20), ...(current ? { supplierId: current.id, supplierName: current.name } : {}) });
  });
  return { items, suppliers, badLines };
}

/** The catalogue as text for a model: grouped under each supplier when there are several. */
export function catalogueText(items: CatalogItem[]): string {
  const groups = new Map<string, CatalogItem[]>();
  for (const item of items) {
    const key = item.supplierName ?? "";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const out: string[] = [];
  for (const [name, list] of groups) {
    if (groups.size > 1 || name) out.push(name ? `Supplier: ${name}` : "Supplier: (not named)");
    for (const i of list) out.push(`${i.id} | ${i.name} | ${i.unit}`);
  }
  return out.join("\n");
}

/**
 * How buyers really speak Georgian, for the model's ears. Shared by the one-shot and the live instructions.
 * (The spoken-number and unit forms follow the project's import dictionary, `lib/catalog/units.ts`.)
 */
export const GEORGIAN_LISTENING = [
  "How buyers really speak (understand all of this, answer only in Georgian):",
  "- Numbers come as digits or words. Georgian counts in twenties, so build compound numbers by adding: 11 თერთმეტი, 12 თორმეტი, 13 ცამეტი, 14 თოთხმეტი, 15 თხუთმეტი, 16 თექვსმეტი, 17 ჩვიდმეტი, 18 თვრამეტი, 19 ცხრამეტი; 20 ოცი, 21 ოცდაერთი, 25 ოცდახუთი, 30 ოცდაათი, 35 ოცდათხუთმეტი, 40 ორმოცი, 45 ორმოცდახუთი, 50 ორმოცდაათი, 60 სამოცი, 70 სამოცდაათი, 80 ოთხმოცი, 90 ოთხმოცდაათი, 99 ოთხმოცდაცხრამეტი; 100 ასი, 120 ას ოცი, 150 ას ორმოცდაათი, 200 ორასი, 300 სამასი, 500 ხუთასი, 900 ცხრაასი, 1000 ათასი, 1500 ათას ხუთასი. Do not mix up ორი (2) with ოცი (20), ოთხი (4) with ორმოცი (40), ათი (10) with ათასი (1000), ცხრა (9) with ცხრამეტი (19).",
  "- Fractions: ნახევარი (0.5), ერთნახევარი / 'ერთი და ნახევარი' (1.5), ორნახევარი / 'ორი კილონახევარი' / '2 და ნახევარი' (2.5), მეოთხედი (0.25), 'სამი მეოთხედი' (0.75), 'ორი მთელი ხუთი' (2.5), 'ნახევარი ლიტრი' (0.5 l). 'ასი გრამი' is 100 g, 'ორასი გრამი' is 200 g, 'ნახევარი კილო' is 0.5 kg.",
  "- Check numbers before you act: say the number back in your head with its unit and ask whether the amount is believable for this product. Confirm once, out loud, any quantity of 50 or more, and any quantity where the word could be two numbers (ორი or ოცი, ხუთი or ორმოცდახუთი). Never guess.",
  "- Units: კილო / კგ / კილოგრამი, გრამი / გრ, ლიტრი / ლ, ცალი, ყუთი / კოლოფი, შეკვრა / პაკეტი, ბოთლი. Pass the unit exactly as said.",
  "- Product names arrive in any case and with small slips: 'ყველს', 'ყველის', 'ქათმის ფილეს', 'პომიდორს', 'პომიდვრის', 'ლუდის', 'კოკოკოლა', 'კათმისი ფილე'. Match them to the closest catalogue name by its stem, and ask if two products are close.",
  "- Request words: მინდა, მომიტანეთ, ჩამიწერეთ, დამიმატეთ, ასევე, ესეც (add); ამოშალეთ, ამოიღეთ, აღარ მინდა (remove); შეცვალეთ, გამოასწორეთ, 'არა, ... იყოს' (change).",
  "- Buyers sometimes mix in Russian, Turkish or English words ('eksi 4'lü', 'коробка'). Understand them, but answer in Georgian.",
  "- If you are not sure what you heard, repeat the part you understood and ask the buyer to confirm. Never guess a number or a product.",
].join("\n");

export const SYSTEM_INSTRUCTION = [
  "You turn a short spoken Georgian wholesale order into structured order lines.",
  "The speaker is a restaurant or cafe buyer ordering from ONE supplier. The audio is in Georgian (sometimes with Latin brand names).",
  "Use ONLY the products in the catalogue list given in the user message. Never invent a product or an id.",
  "If the audio has no clear spoken words (silence, noise, music, a tone), set transcript to an empty string and return no lines and no questions. Never invent an order.",
  "transcript: write what was said, in Georgian script, as accurately as you can.",
  "For each product the speaker orders, add one line: spoken (the words used), productId (a catalogue id, or null when nothing matches),",
  "candidates (catalogue ids it could be, only when you are unsure), quantity (a number, in the unit the speaker used), unit (kg, g, l, ml, piece, box, pack, bottle, ... as spoken),",
  "confidence (0 to 1, how sure you are about product AND quantity).",
  "If the speaker corrects themselves (for example 'five kilos... no, six kilos'), keep only the final value.",
  "The catalogue may list several suppliers, and the same product can be sold by more than one. If the speaker names a supplier, use that supplier's product ids. If they do not and several suppliers sell the product, set productId to null, list the candidates and add a short question asking which supplier.",
  "The catalogue may list several suppliers, and the same product can be sold by more than one. If the speaker names a supplier, use that supplier's product ids. If they do not and several suppliers sell the product, set productId to null, list the candidates and add a short question asking which supplier.",
  "If a name fits several catalogue products (for example just 'cheese' when there are two cheeses), set productId to null, list them in candidates and add a short question in English.",
  "If the order refers to history ('same as last week') you cannot know it: add a question instead of guessing.",
  "deliveryDay: the day or date the speaker asked for, as spoken (for example 'tomorrow', 'Friday'), or null.",
  "questions: short English questions for anything unclear. Empty when everything is clear.",
  "Answer with JSON only.",
].join("\n") + "\n\n" + GEORGIAN_LISTENING;

export function catalogPrompt(items: CatalogItem[]): string {
  return `Catalogue (id | name | unit):\n${catalogueText(items)}\n\nThe order is in the audio.`;
}

/** Gemini `responseSchema` (OpenAPI subset). */
export const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    transcript: { type: "STRING" },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          spoken: { type: "STRING" },
          productId: { type: "STRING", nullable: true },
          candidates: { type: "ARRAY", items: { type: "STRING" } },
          quantity: { type: "NUMBER", nullable: true },
          unit: { type: "STRING", nullable: true },
          confidence: { type: "NUMBER" },
        },
        required: ["spoken", "productId", "candidates", "quantity", "unit", "confidence"],
      },
    },
    deliveryDay: { type: "STRING", nullable: true },
    questions: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["transcript", "lines", "deliveryDay", "questions"],
} as const;

/**
 * How the spoken unit relates to the catalogue's: `ok` same unit, `assumed` nothing was said so the catalogue's is used,
 * `converted` grams to kilos or millilitres to litres (the quantity was converted), `mismatch` anything else (pieces for a
 * product sold in litres, an unknown word): a person must settle it, nothing is guessed. `none` = no product matched.
 */
export type UnitCheck = "none" | "ok" | "assumed" | "converted" | "mismatch";

export type ParsedLine = {
  spoken: string;
  productId: string | null;
  productName: string | null;
  /** The supplier the matched product belongs to, when the catalogue has several. */
  supplierName: string | null;
  candidates: { id: string; name: string; supplierName: string | null }[];
  /** Thousandths of the unit, like every quantity in 202. Null when no usable number was heard. */
  quantityMilli: number | null;
  /** The unit the quantity is in: the catalogue's after `ok`, `assumed` or `converted`, what was said on a `mismatch`. */
  unit: string | null;
  /** What the speaker said, as the model wrote it. */
  spokenUnit: string | null;
  catalogUnit: string | null;
  unitCheck: UnitCheck;
  confidence: number;
};

export type ParsedOrder = {
  transcript: string;
  lines: ParsedLine[];
  deliveryDay: string | null;
  questions: string[];
};

const MAX_LINES = 50;

// Only these pairs convert, each with the factor from the spoken unit to the catalogue's.
const CONVERSIONS: Partial<Record<ProductUnit, Partial<Record<ProductUnit, number>>>> = {
  g: { kg: 1 / 1000 },
  kg: { g: 1000 },
  ml: { l: 1 / 1000 },
  l: { ml: 1000 },
};

/** Settles the unit of one line. Pure: the quantity comes in as a plain number of the spoken unit. */
export function reconcileUnit(
  quantity: number | null,
  spokenUnit: string | null,
  catalogUnit: string | null,
): { quantityMilli: number | null; unit: string | null; unitCheck: UnitCheck } {
  const toMilli = (q: number | null) => (q !== null && q > 0 && q <= 100_000 ? Math.round(q * 1000) : null);
  if (catalogUnit === null) return { quantityMilli: toMilli(quantity), unit: spokenUnit, unitCheck: "none" };
  if (!spokenUnit) return { quantityMilli: toMilli(quantity), unit: catalogUnit, unitCheck: "assumed" };
  const said = parseUnit(spokenUnit);
  const sold = parseUnit(catalogUnit);
  const sameWord = spokenUnit.trim().toLowerCase() === catalogUnit.trim().toLowerCase();
  if ((said !== null && said === sold) || (said === null && sold === null && sameWord)) {
    return { quantityMilli: toMilli(quantity), unit: catalogUnit, unitCheck: "ok" };
  }
  const factor = said && sold ? CONVERSIONS[said]?.[sold] : undefined;
  if (factor !== undefined && quantity !== null) {
    return { quantityMilli: toMilli(quantity * factor), unit: catalogUnit, unitCheck: "converted" };
  }
  return { quantityMilli: toMilli(quantity), unit: spokenUnit, unitCheck: "mismatch" };
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Never trusts the model: ids not in the catalogue become null, numbers are range-checked. */
export function normalizeResult(raw: unknown, items: CatalogItem[]): ParsedOrder {
  const byId = new Map(items.map((i) => [i.id, i]));
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawLines = Array.isArray(obj.lines) ? obj.lines.slice(0, MAX_LINES) : [];
  const lines: ParsedLine[] = rawLines.map((entry) => {
    const l = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const product = typeof l.productId === "string" ? byId.get(l.productId) : undefined;
    const candidates = (Array.isArray(l.candidates) ? l.candidates : [])
      .filter((c): c is string => typeof c === "string" && byId.has(c))
      .slice(0, 5)
      .map((id) => ({ id, name: byId.get(id)!.name, supplierName: byId.get(id)!.supplierName ?? null }));
    const q = typeof l.quantity === "number" && Number.isFinite(l.quantity) ? l.quantity : null;
    const confidence = typeof l.confidence === "number" && Number.isFinite(l.confidence) ? Math.min(1, Math.max(0, l.confidence)) : 0;
    const spokenUnit = text(l.unit, 20) || null;
    const settled = reconcileUnit(q, spokenUnit, product?.unit ?? null);
    return {
      spoken: text(l.spoken, 200),
      productId: product?.id ?? null,
      productName: product?.name ?? null,
      supplierName: product?.supplierName ?? null,
      candidates,
      quantityMilli: settled.quantityMilli,
      unit: settled.unit,
      spokenUnit,
      catalogUnit: product?.unit ?? null,
      unitCheck: settled.unitCheck,
      confidence,
    };
  });
  const questions = (Array.isArray(obj.questions) ? obj.questions : [])
    .map((q) => text(q, 200))
    .filter(Boolean)
    .slice(0, 10);
  return { transcript: text(obj.transcript, 2000), lines, deliveryDay: text(obj.deliveryDay, 80) || null, questions };
}

/**
 * Starting list for the test page: two made-up suppliers that both sell some of the same products (cheese, milk, butter, tomatoes),
 * and each with products the other does not have. Two cheeses at the first supplier keep "cheese" ambiguous on purpose.
 */
export const SAMPLE_CATALOG = [
  "# id | name | unit. A line starting with @ starts a supplier: @id | name. Made-up data, nothing real.",
  "@sa | [TEST] მომწოდებელი ა",
  "p01 | სულგუნი | kg",
  "p02 | იმერული ყველი | kg",
  "p03 | რძე 3.2% | l",
  "p04 | კარაქი | kg",
  "p05 | პომიდორი | kg",
  "p06 | კიტრი | kg",
  "p08 | კარტოფილი | kg",
  "p09 | ხახვი | kg",
  "p13 | მინერალური წყალი | bottle",
  "p14 | ლუდი | box",
  "p20 | ლიმონი | box",
  "p23 | კოკა-კოლა | bottle",
  "p24 | სპრაიტი | bottle",
  "@sb | [TEST] მომწოდებელი ბ",
  "q01 | სულგუნი | kg",
  "q03 | რძე 3.2% | l",
  "q04 | კარაქი | kg",
  "q05 | პომიდორი | kg",
  "q07 | ქათმის ფილე | box",
  "q10 | ფქვილი | kg",
  "q11 | შაქარი | kg",
  "q12 | მზესუმზირის ზეთი | l",
  "q15 | ძროხის ხორცი | kg",
  "q16 | ნაღები | l",
  "q18 | მოცარელა | kg",
  "q19 | პარმეზანი | kg",
  "q22 | ფეტა | kg",
  "q27 | კვერცხი | piece",
].join("\n");
