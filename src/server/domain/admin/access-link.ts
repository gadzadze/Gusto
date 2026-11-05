import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { allowedEmails, supplierRequests } from "@/server/db/schema";
import { writeAudit } from "@/server/domain/audit";
import { assertAdmin, type AdminCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";
import { isUuid } from "@/server/domain/catalog/products";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { ensureAuthUser, signInLinkFor } from "@/server/supabase/admin";

export type AccessLink = { email: string; link: string; phone: string | null };

/**
 * A one-time sign-in link for an accepted address, for the admin to hand over (WhatsApp)
 * while no email provider is connected. Same link as the welcome email. It is returned to
 * the caller once and never stored or logged; only that it was made is audited. Whoever
 * opens it first gets in, which is why it is admin-only, rate limited and audited.
 * `phone` is the number from the address's supplier request, if there is one.
 */
export async function createAccessLink(ctx: AdminCtx, allowedEmailId: string): Promise<AccessLink> {
  assertAdmin(ctx);
  if (!isUuid(allowedEmailId)) throw new NotFoundError("allowed_email");
  const db = getDb();
  const [row] = await db.select({ email: allowedEmails.email, revokedAt: allowedEmails.revokedAt }).from(allowedEmails).where(eq(allowedEmails.id, allowedEmailId));
  if (!row || row.revokedAt) throw new NotFoundError("allowed_email");
  await consumeRateLimit(RATE_LIMITS.adminSignInLink, ctx.userId);
  await ensureAuthUser(row.email);
  const link = await signInLinkFor(row.email);
  const [request] = await db
    .select({ phone: supplierRequests.phone })
    .from(supplierRequests)
    .where(eq(supplierRequests.email, row.email))
    .orderBy(desc(supplierRequests.createdAt))
    .limit(1);
  await writeAudit(db, { actorUserId: ctx.userId, action: "access.link_created", targetType: "allowed_email", targetId: row.email });
  return { email: row.email, link, phone: request?.phone ?? null };
}
