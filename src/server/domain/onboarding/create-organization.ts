import { linkInvitesToSupplier } from "@/server/domain/buyer/supplier-invites";
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
  constructor(public readonly code: "already_onboarded" | "legal_id_taken" | "already_has_kind" | "not_onboarded") {
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
export type CreateOptions = {
  preapprovedLegalId?: string | null;
  /**
   * Adds a second side (buyer or supplier) for a person who already has an organization.
   * It starts `active` at once when the person's other side is active and the legal ID is the
   * same (the admin already vetted that business); otherwise it waits for review.
   */
  addSide?: boolean;
  /** The address the person signed in with: a supplier's buyer invitations are matched by it. */
  signInEmail?: string | null;
};

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
    .select({ type: organizations.type, status: organizations.status, legalId: organizations.legalId })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(eq(organizationMemberships.userId, userId));
  if (options.addSide) {
    if (existing.length === 0) throw new OnboardingError("not_onboarded");
    if (existing.some((m) => m.type === input.kind)) throw new OnboardingError("already_has_kind");
  } else if (existing.length > 0) {
    throw new OnboardingError("already_onboarded");
  }

  const legalId = options.preapprovedLegalId ?? input.legalId;
  const sameBusinessActive = existing.some((m) => m.status === "active" && m.legalId === legalId);
  const status: OrgStatus = options.preapprovedLegalId || (options.addSide && sameBusinessActive) ? "active" : "pending_review";
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
    await linkInvitesToSupplier(tx, options.signInEmail, org.id);
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
    data: { type: org.type, status: org.status, preapproved: !!options.preapprovedLegalId, addedSide: !!options.addSide },
  });

  return { orgId: org.id, orgType: org.type, status: org.status };
}

/**
 * A business that buys and resells chooses both sides at first onboarding: one set of
 * details, two organizations (buyer first), in one transaction. Both start `active` when
 * the admin vetted the address, both wait for review otherwise.
 */
export async function createBothForUser(
  userId: string,
  buyer: Extract<OnboardingValues, { kind: "buyer" }>,
  supplier: Extract<OnboardingValues, { kind: "supplier" }>,
  options: CreateOptions = {},
): Promise<{ buyer: { orgId: string; status: OrgStatus }; supplier: { orgId: string; status: OrgStatus } }> {
  return getDb().transaction(async (tx) => {
    const b = await createOrganizationInTx(tx, userId, buyer, options);
    const s = await createOrganizationInTx(tx, userId, supplier, { ...options, addSide: true });
    return { buyer: { orgId: b.orgId, status: b.status }, supplier: { orgId: s.orgId, status: s.status } };
  });
}

/** What a second side starts from: the person's own organization's details. */
export async function organizationPrefill(orgId: string) {
  const [org] = await getDb()
    .select({
      businessName: organizations.name,
      legalId: organizations.legalId,
      contactName: organizations.contactName,
      phone: organizations.phone,
      city: organizations.city,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return org ?? null;
}
