import "server-only";
import { and, count, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { SupplierRequestValues } from "@/lib/validation/supplier-request";
import { getDb } from "@/server/db/client";
import { organizations, supplierRequests, type SupplierRequestStatus } from "@/server/db/schema";
import { writeAudit } from "@/server/domain/audit";
import { assertAdmin, type AdminCtx } from "@/server/domain/context";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { claimSupplierInvite } from "@/server/domain/buyer/supplier-invites";
import { allowEmail, type AccessError } from "./access";

// Prospective suppliers who found 202 through a partner's WhatsApp message
// and asked to be onboarded. A request grants nothing: only the admin's approval
// puts the address on the allow-list (with the business name and legal ID,
// so the supplier then starts active).

export type RequestError = "stale_status" | "note_required" | "legal_id_taken" | "invalid_legal_id" | "invalid_email";

/**
 * Stores a public submission. Returns "duplicate" (nothing stored) when an open
 * request already exists for the address or the business, or the business is
 * already a registered supplier; the caller shows the same thank-you either
 * way, so the form can't be used to probe who is registered.
 */
export async function createSupplierRequest(values: SupplierRequestValues, inviteToken?: string | null): Promise<"created" | "duplicate"> {
  const db = getDb();
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.type, "supplier"), eq(organizations.legalId, values.legalId)))
    .limit(1);
  if (org) return "duplicate";
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(supplierRequests)
      .values({
        businessName: values.businessName,
        legalId: values.legalId,
        contactName: values.contactName,
        phone: values.phone,
        email: values.email,
        city: values.city,
        note: values.note ?? null,
      })
      // The partial unique indexes (open request per ID / per address) decide.
      .onConflictDoNothing()
      .returning({ id: supplierRequests.id });
    if (inserted.length === 0) return "duplicate" as const;
    // A buyer's invitation link is claimed only by a request that was really stored;
    // an unusable token just leaves this a plain request.
    const inviteId = await claimSupplierInvite(tx, inviteToken, values.businessName);
    if (inviteId) await tx.update(supplierRequests).set({ inviteId }).where(eq(supplierRequests.id, inserted[0].id));
    return "created" as const;
  });
}

export type RequestListItem = typeof supplierRequests.$inferSelect & { invitedByBuyer: string | null };

export async function listSupplierRequests(ctx: AdminCtx, status?: SupplierRequestStatus): Promise<RequestListItem[]> {
  assertAdmin(ctx);
  return getDb()
    .select({
      ...getTableColumns(supplierRequests),
      invitedByBuyer: sql<string | null>`(
        select o.name from buyer_supplier_invites i join organizations o on o.id = i.buyer_org_id
        where i.id = ${supplierRequests.inviteId}
      )`,
    })
    .from(supplierRequests)
    .where(status ? eq(supplierRequests.status, status) : undefined)
    // Open ones first, oldest waiting first; finished ones newest first.
    .orderBy(
      sql`case ${supplierRequests.status} when 'new' then 0 when 'contacted' then 1 else 2 end`,
      sql`case when ${supplierRequests.status} in ('new', 'contacted') then ${supplierRequests.createdAt} end asc`,
      desc(supplierRequests.createdAt),
    )
    .limit(300);
}

export async function countSupplierRequests(ctx: AdminCtx): Promise<Record<SupplierRequestStatus, number>> {
  assertAdmin(ctx);
  const rows = await getDb()
    .select({ status: supplierRequests.status, n: count() })
    .from(supplierRequests)
    .groupBy(supplierRequests.status);
  const out: Record<SupplierRequestStatus, number> = { new: 0, contacted: 0, approved: 0, rejected: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export type RequestAction = "contacted" | "approve" | "reject";

const noteSchema = z.string().trim().max(500);

const RULES: Record<RequestAction, { from: SupplierRequestStatus[]; to: SupplierRequestStatus; needsNote: boolean }> = {
  contacted: { from: ["new"], to: "contacted", needsNote: false },
  approve: { from: ["new", "contacted"], to: "approved", needsNote: false },
  reject: { from: ["new", "contacted"], to: "rejected", needsNote: true },
};

/**
 * Moves a request along. Conditional on the current status (two admins can't
 * both act), audited. Approving registers the address on the allow-list as a
 * supplier with the verified business name and legal ID, in the same step.
 */
export async function reviewSupplierRequest(
  ctx: AdminCtx,
  id: string,
  action: RequestAction,
  rawNote?: string,
): Promise<{ email: string }> {
  assertAdmin(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("request");
  const rule = RULES[action];
  const parsedNote = noteSchema.safeParse(rawNote ?? "");
  const note = parsedNote.success && parsedNote.data ? parsedNote.data : null;
  if (rule.needsNote && (!note || note.length < 3)) throw new StateError<RequestError>("note_required");

  const db = getDb();
  const [row] = await db.select().from(supplierRequests).where(eq(supplierRequests.id, id));
  if (!row) throw new NotFoundError("request");
  if (!rule.from.includes(row.status)) throw new StateError<RequestError>("stale_status");

  if (action === "approve") {
    // Registers (or restores / updates) the address; refuses a legal ID that
    // already belongs to another business. Idempotent if retried.
    try {
      await allowEmail({ userId: ctx.userId }, row.email, note ?? `Request ${row.createdAt.toISOString().slice(0, 10)}`, "supplier", {
        businessName: row.businessName,
        legalId: row.legalId,
      });
    } catch (error) {
      if (error instanceof StateError) throw new StateError<RequestError | AccessError>(error.code as AccessError);
      throw error;
    }
  }

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(supplierRequests)
      .set({
        status: rule.to,
        reviewedByUserId: ctx.userId,
        reviewedAt: new Date(),
        ...(note ? { adminNote: note } : {}),
      })
      .where(and(eq(supplierRequests.id, id), inArray(supplierRequests.status, rule.from)))
      .returning({ id: supplierRequests.id });
    if (updated.length === 0) throw new StateError<RequestError>("stale_status");
    await writeAudit(tx, {
      actorUserId: ctx.userId,
      action: `request.${action}`,
      targetType: "supplier_request",
      targetId: id,
      data: { before: row.status, after: rule.to, legalId: row.legalId, note },
    });
  });
  return { email: row.email };
}
