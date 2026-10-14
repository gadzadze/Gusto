// Search skeleton: maps Georgian script and the many ways people type it in
// Latin letters to one lowercase Latin form, so "ყველი", "kveli", "qveli"
// and "yveli" all become "kveli". Lossy on purpose — it is only used for
// matching, and queries go through the same function.
//
// Pure (no server-only import) so it can be unit-tested and reused.

const GEORGIAN: Record<string, string> = {
  ა: "a", ბ: "b", გ: "g", დ: "d", ე: "e", ვ: "v", ზ: "z", თ: "t", ი: "i",
  კ: "k", ლ: "l", მ: "m", ნ: "n", ო: "o", პ: "p", ჟ: "zh", რ: "r", ს: "s",
  ტ: "t", უ: "u", ფ: "p", ქ: "k", ღ: "g", ყ: "k", შ: "sh", ჩ: "ch", ც: "c",
  ძ: "dz", წ: "c", ჭ: "ch", ხ: "x", ჯ: "j", ჰ: "h",
};

// Applied to Latin runs only, longest patterns first. Covers the national
// romanization (kh, gh, ts, q, apostrophes) and keyboard-layout typing
// (w = წ, y = ყ, x = ხ, f = ფ).
const LATIN_RULES: [RegExp, string][] = [
  [/['’`ʼ]/g, ""],
  [/kh/g, "x"],
  [/gh/g, "g"],
  [/th/g, "t"],
  [/ph/g, "p"],
  [/ts/g, "c"],
  [/[qy]/g, "k"],
  [/w/g, "c"],
  [/f/g, "p"],
];

const GEORGIAN_RUN = /[ა-ჿ]+/g;

function latinSkeleton(text: string): string {
  let out = text;
  for (const [pattern, replacement] of LATIN_RULES) out = out.replace(pattern, replacement);
  return out;
}

/** Normalizes text (either script) to its search skeleton. */
export function searchSkeleton(text: string): string {
  const lower = text.normalize("NFC").toLowerCase();
  let out = "";
  let last = 0;
  for (const match of lower.matchAll(GEORGIAN_RUN)) {
    out += latinSkeleton(lower.slice(last, match.index));
    for (const ch of match[0]) out += GEORGIAN[ch] ?? "";
    last = match.index + match[0].length;
  }
  out += latinSkeleton(lower.slice(last));
  return out.replace(/\s+/g, " ").trim();
}

/**
 * What gets stored in `products.search_text`: the fields as typed
 * (lowercased) plus their skeletons, so both exact substrings and
 * transliterated queries match.
 */
export function buildSearchText(fields: (string | null | undefined)[]): string {
  const present = fields.filter((f): f is string => Boolean(f && f.trim()));
  const raw = present.map((f) => f.toLowerCase().trim()).join(" ");
  const skeleton = present.map(searchSkeleton).join(" ");
  return `${raw} ${skeleton}`.trim();
}

/** Escapes LIKE wildcards in user input. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
