/**
 * Accepts a post-login destination only if it is a same-site path, so a
 * crafted `?next=` can't send someone to another origin.
 */
export function safeNextPath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  if (input.length === 0 || input.length > 512) return null;
  if (!input.startsWith("/") || input.startsWith("//")) return null;
  if (input.includes("\\")) return null;
  // Reject control characters, which some browsers strip before resolving.
  for (let i = 0; i < input.length; i++) {
    if (input.charCodeAt(i) < 0x20 || input.charCodeAt(i) === 0x7f) return null;
  }
  return input;
}
