// Builds a wa.me link that opens WhatsApp with a prefilled message. The user
// sends it themselves — Gusto never records this as a delivered notification
// (CLAUDE.md, "Product honesty rules").

/** `phone` in any format with a country code (E.164 preferred). Returns null if unusable. */
export function whatsappLink(phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** A wa.me link with no recipient: WhatsApp lets the sender pick the chat. */
export function whatsappShareLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
