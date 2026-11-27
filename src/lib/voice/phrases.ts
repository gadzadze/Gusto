// How a buyer says a product when ordering by voice. Pure helpers: what counts as a phrase worth remembering, and how it is
// written down so "ყველი" and " ყველი. " are the same one. The server stores only phrases from lines the buyer kept.

export const MAX_PHRASE_CHARS = 60;
/** At most this many remembered phrases per buyer organization; the least recently used go first. */
export const MAX_PHRASES_PER_BUYER = 200;
/** At most this many "also said" hints per product are given to the assistant. */
export const MAX_HINTS_PER_PRODUCT = 3;

/** Lower-cased, punctuation and extra spaces removed. */
export function normalizePhrase(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[.,;:!?"'«»„“”()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PHRASE_CHARS);
}

/**
 * The phrase to remember for a line, or null. Worth keeping only when it is a name (no numbers, no unit words said with it), has a
 * real length, and is not simply the product's own name.
 */
export function phraseToLearn(spoken: string | null | undefined, productName: string): string | null {
  if (!spoken) return null;
  const phrase = normalizePhrase(spoken);
  if (phrase.length < 2 || phrase.length > MAX_PHRASE_CHARS) return null;
  if (/\d/.test(phrase)) return null;
  if (phrase.split(" ").length > 5) return null;
  if (phrase === normalizePhrase(productName)) return null;
  return phrase;
}
