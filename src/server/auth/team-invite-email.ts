import "server-only";
import { getTranslations } from "next-intl/server";
import { sendEmail } from "@/server/notifications/email";
import { ensureAuthUser, signInLinkFor } from "@/server/supabase/admin";
import type { WelcomeResult } from "./welcome-email";

/**
 * Tells a colleague that a company added them, with the one-time sign-in link (it lands on the
 * set-password page like any first sign-in). Sent directly, never through the outbox, and the link is
 * never stored or logged. Called only after an owner invited this address. A failure never undoes the
 * invitation: the person can ask for a new link with "set or reset password" on the sign-in page.
 * Always Georgian: we do not know the colleague's language.
 */
export async function sendTeamInviteEmail(email: string, companyNames: string[]): Promise<WelcomeResult> {
  try {
    await ensureAuthUser(email);
    const link = await signInLinkFor(email);
    const t = await getTranslations({ locale: "ka", namespace: "teamInviteEmail" });
    const result = await sendEmail({
      to: email,
      subject: t("subject"),
      text: t("body", { companies: companyNames.join(", "), link }),
    });
    return result === "sent" ? "sent" : "skipped";
  } catch (error) {
    console.error("[team] invite email failed", { message: error instanceof Error ? error.message : String(error) });
    return "failed";
  }
}
