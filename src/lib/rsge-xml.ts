// Tiny XML helpers for the RS.ge SOAP service. Everything we send is escaped; everything we read is a flat
// element lookup (RS.ge answers are small and flat), so no XML library is needed.

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

export function xmlEscape(value: string | number): string {
  // Control characters (except tab, newline, return) are not allowed in XML 1.0 at all: drop them.
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function xmlUnescape(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/** `<NAME>escaped value</NAME>`; null/undefined/"" becomes an empty element. */
export function el(name: string, value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? `<${name}></${name}>` : `<${name}>${xmlEscape(value)}</${name}>`;
}

/** The text of the first `<name>` element (any namespace prefix), or null. */
export function firstText(xml: string, name: string): string | null {
  const match = new RegExp(`<(?:[A-Za-z0-9_]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${name}>`).exec(xml);
  return match ? xmlUnescape(match[1].trim()) : null;
}

/** All `<name>…</name>` blocks (inner XML), in order. */
export function allBlocks(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[A-Za-z0-9_]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${name}>`, "g");
  return Array.from(xml.matchAll(re), (m) => m[1]);
}

/** The raw inner XML of the first `<name>` element, not unescaped (for nested XML such as a whole waybill). */
export function firstRaw(xml: string, name: string): string | null {
  const match = new RegExp(`<(?:[A-Za-z0-9_]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${name}>`).exec(xml);
  return match ? match[1].trim() : null;
}
