import "server-only";
import { eq } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { createTranslator } from "next-intl";
import messages from "../../../messages/ka.json";
import { getDb } from "@/server/db/client";
import { profiles } from "@/server/db/schema";
import { sendEmail } from "./email";
import { appUrl } from "./links";

const t = createTranslator({ locale: "ka", messages, namespace: "adminAlerts" }) as unknown as (
  key: string,
  values?: Record<string, string>,
) => string;

/**
 * Tells every platform admin a business is waiting for approval. Sent directly
 * (best effort, never throws): it carries only the business name and a link to
 * the review list, nothing secret, and the admin area also shows a badge.
 */
export async function notifyAdminsOrgPending(
  kind: "supplier" | "buyer",
  businessName: string,
): Promise<{ attempted: number }> {
  const admins = await getDb()
    .select({ email: authUsers.email })
    .from(profiles)
    .innerJoin(authUsers, eq(authUsers.id, profiles.id))
    .where(eq(profiles.isPlatformAdmin, true));
  const to = admins.map((a) => a.email).filter((e): e is string => Boolean(e));
  if (to.length === 0) return { attempted: 0 };

  const path = kind === "supplier" ? "/admin/suppliers?status=pending_review" : "/admin/organizations?type=buyer&status=pending_review";
  const link = `${appUrl()}${path}`;
  const subject = t(`${kind}PendingSubject`);
  const text = [t(`${kind}PendingBody`, { name: businessName }), "", t(`${kind}PendingLink`, { link })].join("\n");
  for (const address of to) {
    try {
      await sendEmail({ to: address, subject, text });
    } catch (error) {
      console.error("[admin-alert] email failed", { message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { attempted: to.length };
}

export const notifyAdminsSupplierPending = (businessName: string) => notifyAdminsOrgPending("supplier", businessName);
