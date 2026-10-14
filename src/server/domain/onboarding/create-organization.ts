import "server-only";
import { eq, sql } from "drizzle-orm";
import type { OnboardingValues } from "@/lib/validation/onboarding";
import { getDb, type Tx } from "@/server/db/client";
import {
  addresses,
  organizationMemberships,
  organizations,
  profiles,
  supplierSettings,
  type OrgType,
} from "@/server/db/schema";
import { writeAudit } from "@/server/domain/audit";

export class OnboardingError extends Error {
  constructor(public readonly code: "already_onboarded") {
    super(code);
    this.name = "OnboardingError";
  }
}

/**
 * Creates the user's organization, their owner membership and the type's
 * first settings row, in one transaction.
 *
 * The status is decided here, never by the caller: buyers start `active`,
 * suppliers `pending_review` until an admin approves them.
 */
export async function createOrganizationForUser(
  userId: string,
  input: OnboardingValues,
): Promise<{ orgId: string; orgType: OrgType }> {
  return getDb().transaction((tx) => createOrganizationInTx(tx, userId, input));
}

/** Same as createOrganizationForUser, inside a caller's transaction (e.g. accepting an invitation). */
export async function createOrganizationInTx(
  tx: Tx,
  userId: string,
  input: OnboardingValues,
): Promise<{ orgId: string; orgType: OrgType }> {
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

  const [org] = await tx
    .insert(organizations)
    .values({
      type: input.kind,
      status: input.kind === "buyer" ? "active" : "pending_review",
      name: input.businessName,
      businessType: input.kind === "buyer" ? input.businessType : null,
      legalId: input.kind === "supplier" ? (input.legalId ?? null) : null,
      contactName: input.contactName,
      phone: input.phone,
      city: input.city,
    })
    .returning({ id: organizations.id, type: organizations.type });

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
    data: { type: org.type },
  });

  return { orgId: org.id, orgType: org.type };
}
