import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { OnboardingValues } from "@/lib/validation/onboarding";
import { getDb, type Tx } from "@/server/db/client";
import {
  addresses,
  organizationMemberships,
  organizations,
  profiles,
  supplierSettings,
  type OrgStatus,
  type OrgType,
} from "@/server/db/schema";
import { writeAudit } from "@/server/domain/audit";

export class OnboardingError extends Error {
  constructor(public readonly code: "already_onboarded" | "legal_id_taken") {
    super(code);
    this.name = "OnboardingError";
  }
}

/**
 * Creates the user's organization, their owner membership and the type's
 * first settings row, in one transaction.
 *
 * The status is decided here, never by the caller. An organization starts
 * `pending_review` (the admin checks the legal ID and calls them) unless the
 * admin already vetted the business when registering the address: then
 * `preapprovedLegalId` is that vetted ID, it replaces whatever was typed, and
 * the organization starts `active`.
 */
export type CreateOptions = { preapprovedLegalId?: string | null };

export async function createOrganizationForUser(
  userId: string,
  input: OnboardingValues,
  options: CreateOptions = {},
): Promise<{ orgId: string; orgType: OrgType; status: OrgStatus }> {
  return getDb().transaction((tx) => createOrganizationInTx(tx, userId, input, options));
}

/** Same as createOrganizationForUser, inside a caller's transaction (e.g. accepting an invitation). */
export async function createOrganizationInTx(
  tx: Tx,
  userId: string,
  input: OnboardingValues,
  options: CreateOptions = {},
): Promise<{ orgId: string; orgType: OrgType; status: OrgStatus }> {
  await tx
    .insert(profiles)
    .values({ id: userId, fullName: input.contactName, phone: input.phone })
    .onConflictDoUpdate({
      target: profiles.id,
      set: {
        fullName: sql`coalesce(${profiles.fullName}, excluded.full_name)`,
        phone: sql`coalesce(${profiles.phone}, excluded.phone)`,
      },
    });

  // Serialize concurrent submissions for the same user (double click, two
  // tabs) so the membership check below can't race.
  await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, userId)).for("update");

  const existing = await tx
    .select({ id: organizationMemberships.id })
    .from(organizationMemberships)
    .where(eq(organizationMemberships.userId, userId))
    .limit(1);
  if (existing.length > 0) throw new OnboardingError("already_onboarded");

  const legalId = options.preapprovedLegalId ?? input.legalId;
  const status: OrgStatus = options.preapprovedLegalId ? "active" : "pending_review";
  // One organization per legal ID and kind (the unique index is the backstop).
  const [taken] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.type, input.kind), eq(organizations.legalId, legalId)))
    .limit(1);
  if (taken) throw new OnboardingError("legal_id_taken");

  const [org] = await tx
    .insert(organizations)
    .values({
      type: input.kind,
      status,
      name: input.businessName,
      businessType: input.kind === "buyer" ? input.businessType : null,
      legalId,
      contactName: input.contactName,
      phone: input.phone,
      city: input.city,
    })
    .returning({ id: organizations.id, type: organizations.type, status: organizations.status });

  await tx
    .insert(organizationMemberships)
    .values({ organizationId: org.id, userId, role: "owner" });

  if (input.kind === "supplier") {
    await tx
      .insert(supplierSettings)
      .values({ organizationId: org.id, deliveryArea: input.deliveryArea });
  } else {
    await tx.insert(addresses).values({
      organizationId: org.id,
      city: input.city,
      addressLine: input.addressLine,
      instructions: input.deliveryInstructions ?? null,
      isDefault: true,
    });
  }

  await writeAudit(tx, {
    actorUserId: userId,
    action: "organization.created",
    targetType: "organization",
    targetId: org.id,
    data: { type: org.type, status: org.status, preapproved: !!options.preapprovedLegalId },
  });

  return { orgId: org.id, orgType: org.type, status: org.status };
}
