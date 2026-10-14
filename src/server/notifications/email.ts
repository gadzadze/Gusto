import "server-only";

export type EmailMessage = { to: string; subject: string; text: string };
export type EmailResult = "sent" | "skipped";

/**
 * Email boundary. Real delivery (Resend) arrives in milestone 5; until then
 * nothing is sent and the result says so, so the UI never claims an email
 * went out. Outside production the message is logged as [DEV EMAIL] so it can
 * be followed by hand; in production only the fact is logged, because
 * bodies can contain invitation links (CLAUDE.md: never log invite URLs).
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  if (process.env.NODE_ENV === "production") {
    console.info("[DEV EMAIL] not sent (email delivery not configured)", { subject: message.subject });
  } else {
    console.info(`[DEV EMAIL] to=${message.to} subject=${message.subject}\n${message.text}`);
  }
  return "skipped";
}
