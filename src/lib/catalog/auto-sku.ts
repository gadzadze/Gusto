// A product code for price lists that have none. Derived from the product name
// only, so importing the same list again (even reordered, or with new prices)
// gives the same codes and updates the products instead of duplicating them.
// A renamed product gets a new code, which is a new product.

/** cyrb53: a small, well-spread 53-bit string hash (no crypto needed, and no Node API). */
function cyrb53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export const AUTO_SKU_PREFIX = "A-";

export function generateSku(name: string): string {
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  return AUTO_SKU_PREFIX + cyrb53(key).toString(36).toUpperCase().padStart(10, "0");
}
