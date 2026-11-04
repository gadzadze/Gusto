import "server-only";
import { getTranslations } from "next-intl/server";
import { sendEmail } from "@/server/notifications/email";
import { ensureAuthUser, signInLinkFor } from "@/server/supabase/admin";

export type WelcomeResult = "sent" | "skipped" | "failed";

/**
 * Tells a newly accepted business that its account is ready and gives it the link
 * for the first sign-in (the link lands on the set-password page: every guard sends
 * a person without a password there). Called only after an admin accepted the
 * address, never from anything a stranger can trigger.
 *
 * Sent directly, not through the outbox: the text holds a one-time sign-in link,
 * which Gusto never stores or logs. A failure never undoes the acceptance; the
 * person can always ask for a new link with "set or reset password" on the sign-in page.
 */
export async function sendWelcomeEmail(email: string): Promise<WelcomeResult> {
  try {
    await ensureAuthUser(email);
    const link = await signInLinkFor(email);
    const t = await getTranslations("welcomeEmail");
    const result = await sendEmail({ to: email, subject: t("subject"), text: t("body", { link }) });
    return result === "sent" ? "sent" : "skipped";
  } catch (error) {
    console.error("[welcome] email failed", { message: error instanceof Error ? error.message : String(error) });
    return "failed";
  }
}
