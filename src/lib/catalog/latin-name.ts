// Search words for finding a product abroad. Open Food Facts is in Latin script,
// so a Georgian product name is turned into Latin letters first. Two spellings are
// tried because brands are written both ways ("Qazbegi" by the national system,
// "Kazbegi" on the label). Pure, so it can be unit-tested.

const NATIONAL: Record<string, string> = {
  ა: "a", ბ: "b", გ: "g", დ: "d", ე: "e", ვ: "v", ზ: "z", თ: "t", ი: "i",
  კ: "k", ლ: "l", მ: "m", ნ: "n", ო: "o", პ: "p", ჟ: "zh", რ: "r", ს: "s",
  ტ: "t", უ: "u", ფ: "p", ქ: "k", ღ: "gh", ყ: "q", შ: "sh", ჩ: "ch", ც: "ts",
  ძ: "dz", წ: "ts", ჭ: "ch", ხ: "kh", ჯ: "j", ჰ: "h",
};

const MAX_WORDS = 4;

function romanize(word: string): string {
  return [...word].map((ch) => NATIONAL[ch] ?? ch).join("");
}

/** The words of a name that identify the product: no numbers, sizes, percentages or one-letter bits. */
function meaningfulWords(name: string): string[] {
  return name
    .normalize("NFC")
    .toLowerCase()
    .split(/[^a-zა-ჿ]+/u)
    .filter((w) => w.length >= 2 && !/^(ლ|მლ|გ|კგ|ც|ცალი|ml|kg|l|g|pcs)$/u.test(w));
}

/** Up to two Latin queries for a product name (and brand), best first. */
export function latinSearchQueries(name: string, brand?: string | null): string[] {
  const words = meaningfulWords(`${brand ?? ""} ${name}`).slice(0, MAX_WORDS);
  if (words.length === 0) return [];
  const national = words.map(romanize).join(" ");
  // The spelling printed on labels: q -> k, gh -> g, and kh kept.
  const label = national.replace(/q/g, "k").replace(/gh/g, "g");
  return [...new Set([label, national])];
}
