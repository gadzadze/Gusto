/** "GST-1004", "gst 1004" or "1004" → 1004; anything else → null (the command palette's order-number lookup). */
export function orderNumberFrom(query: string): number | null {
  const m = /^(?:gst[\s-]?)?(\d{4,9})$/i.exec(query.trim());
  return m ? Number(m[1]) : null;
}
