import "server-only";

export type EmailMessage = { to: string; subject: string; text: string; html?: string };
export type EmailResult = "sent" | "skipped";

const RESEND_URL = "https://api.resend.com/emails";

/**
 * Email boundary (Resend). Throws when the provider rejects the message, so
 * callers can retry (the outbox does) or report failure (invitations do).
 *
 * With no RESEND_API_KEY nothing is sent and the result is "skipped", so the
 * UI and the outbox never claim an email went out. Outside production the
 * message is logged as [DEV EMAIL]; in production only the subject is,
 * because bodies can contain invitation links (CLAUDE.md: never log invite
 * URLs).
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      console.info("[DEV EMAIL] not sent (RESEND_API_KEY is not set)", { subject: message.subject });
    } else {
      console.info(`[DEV EMAIL] to=${message.to} subject=${message.subject}\n${message.text}`);
    }
    return "skipped";
  }

  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM is not set.");

  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // Status and Resend's error name only: never the request body or key.
    const body = (await response.json().catch(() => null)) as { name?: string } | null;
    throw new Error(`Resend responded ${response.status}${body?.name ? ` (${body.name})` : ""}`);
  }
  return "sent";
}
