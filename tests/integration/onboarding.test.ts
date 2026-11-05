import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { onboardingSchema, type OnboardingValues } from "@/lib/validation/onboarding";
import { getDb } from "@/server/db/client";
import {
  addresses,
  auditLogs,
  organizationMemberships,
  organizations,
  profiles,
  supplierSettings,
} from "@/server/db/schema";
import {
  OnboardingError,
  createBothForUser,
  createOrganizationForUser,
} from "@/server/domain/onboarding/create-organization";
import { createAuthUser, randomLegalId } from "./helpers";

const buyerInput = (overrides: Record<string, unknown> = {}): OnboardingValues =>
  onboardingSchema.parse({
    kind: "buyer",
    businessName: "[TEST] Café Tbilisi",
    legalId: randomLegalId(),
    businessType: "cafe",
    contactName: "Nino",
    phone: "555 12 34 56",
    city: "თბილისი",
    addressLine: "Rustaveli Ave 1",
    deliveryInstructions: "Back entrance",
    ...overrides,
  });

const supplierInput = (overrides: Record<string, unknown> = {}): OnboardingValues =>
  onboardingSchema.parse({
    kind: "supplier",
    businessName: "[TEST] Beverage Distribution",
    legalId: randomLegalId(),
    contactName: "Giorgi",
    phone: "599 00 00 00",
    city: "თბილისი",
    deliveryArea: "Tbilisi and surroundings",
    ...overrides,
  });

async function orgsOf(userId: string) {
  return getDb()
    .select({ org: organizations, role: organizationMemberships.role })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(eq(organizationMemberships.userId, userId));
}

describe("createOrganizationForUser", () => {
  it("creates a buyer org pending review unless the admin vetted the ID, then active", async () => {
    const unvetted = await createAuthUser();
    await createOrganizationForUser(unvetted.id, buyerInput());
    expect((await orgsOf(unvetted.id))[0].org.status).toBe("pending_review");

    // The admin's verified ID wins over whatever was typed, and starts the org active.
    const vettedId = randomLegalId();
    const vetted = await createAuthUser();
    await createOrganizationForUser(vetted.id, buyerInput({ legalId: "111111111" }), { preapprovedLegalId: vettedId });
    expect((await orgsOf(vetted.id))[0].org).toMatchObject({ status: "active", legalId: vettedId });
  });

  it("refuses a legal ID that is already registered for the same kind", async () => {
    const legalId = randomLegalId();
    await createOrganizationForUser((await createAuthUser()).id, buyerInput({ legalId }));
    await expect(createOrganizationForUser((await createAuthUser()).id, buyerInput({ legalId }))).rejects.toEqual(
      new OnboardingError("legal_id_taken"),
    );
    // The same company may also be a supplier.
    await createOrganizationForUser((await createAuthUser()).id, supplierInput({ legalId }));
  });

  it("creates an active buyer org with owner membership, default address, profile and audit row", async () => {
    const user = await createAuthUser();
    const legalId = randomLegalId();
    const { orgId, orgType } = await createOrganizationForUser(user.id, buyerInput({ legalId }), { preapprovedLegalId: legalId });
    expect(orgType).toBe("buyer");

    const memberships = await orgsOf(user.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe("owner");
    expect(memberships[0].org).toMatchObject({
      id: orgId,
      type: "buyer",
      status: "active",
      businessType: "cafe",
      phone: "+995555123456",
      timezone: "Asia/Tbilisi",
      currency: "GEL",
    });

    const addressRows = await getDb().select().from(addresses).where(eq(addresses.organizationId, orgId));
    expect(addressRows).toEqual([
      expect.objectContaining({ addressLine: "Rustaveli Ave 1", instructions: "Back entrance", isDefault: true }),
    ]);
    const settings = await getDb()
      .select()
      .from(supplierSettings)
      .where(eq(supplierSettings.organizationId, orgId));
    expect(settings).toHaveLength(0);

    const [profile] = await getDb().select().from(profiles).where(eq(profiles.id, user.id));
    expect(profile).toMatchObject({ fullName: "Nino", phone: "+995555123456", isPlatformAdmin: false });

    const audit = await getDb().select().from(auditLogs).where(eq(auditLogs.targetId, orgId));
    expect(audit).toEqual([
      expect.objectContaining({ actorUserId: user.id, action: "organization.created" }),
    ]);
  });

  it("creates a supplier org pending review, with settings and no address", async () => {
    const user = await createAuthUser();
    const { orgId } = await createOrganizationForUser(user.id, supplierInput());

    const [{ org }] = await orgsOf(user.id);
    expect(org).toMatchObject({ type: "supplier", status: "pending_review", businessType: null });

    const settings = await getDb()
      .select()
      .from(supplierSettings)
      .where(eq(supplierSettings.organizationId, orgId));
    expect(settings).toEqual([
      expect.objectContaining({ deliveryArea: "Tbilisi and surroundings", minOrderMinor: 0 }),
    ]);
    const addressRows = await getDb().select().from(addresses).where(eq(addresses.organizationId, orgId));
    expect(addressRows).toHaveLength(0);
  });

  it("refuses a second onboarding for the same user", async () => {
    const user = await createAuthUser();
    await createOrganizationForUser(user.id, buyerInput());
    await expect(createOrganizationForUser(user.id, supplierInput())).rejects.toEqual(
      new OnboardingError("already_onboarded"),
    );
    expect(await orgsOf(user.id)).toHaveLength(1);
  });

  it("creates exactly one org when the same user submits twice at once", async () => {
    const user = await createAuthUser();
    const results = await Promise.allSettled([
      createOrganizationForUser(user.id, buyerInput()),
      createOrganizationForUser(user.id, buyerInput()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toEqual([
      expect.objectContaining({ reason: new OnboardingError("already_onboarded") }),
    ]);
    expect(await orgsOf(user.id)).toHaveLength(1);
  });

  it("ignores a forged status or admin flag in the submitted data", async () => {
    const user = await createAuthUser();
    const input = supplierInput({ status: "active", isPlatformAdmin: true, type: "buyer" });
    await createOrganizationForUser(user.id, input);

    const [{ org }] = await orgsOf(user.id);
    expect(org.type).toBe("supplier");
    expect(org.status).toBe("pending_review");
    const [profile] = await getDb().select().from(profiles).where(eq(profiles.id, user.id));
    expect(profile.isPlatformAdmin).toBe(false);
  });

  it("is atomic: a failure on the last insert leaves nothing behind", async () => {
    const user = await createAuthUser();
    // Make the final insert (the buyer's address) fail for this one test.
    await getDb().execute(sql`
      create or replace function public.test_fail_address() returns trigger language plpgsql as $$
      begin
        if new.city = 'FAIL-CITY' then raise exception 'forced failure'; end if;
        return new;
      end $$;
    `);
    await getDb().execute(sql`
      create trigger fail_address before insert on addresses
      for each row execute function public.test_fail_address()
    `);
    try {
      await expect(createOrganizationForUser(user.id, buyerInput({ city: "FAIL-CITY" }))).rejects.toThrow();
    } finally {
      await getDb().execute(sql`drop trigger if exists fail_address on addresses`);
      await getDb().execute(sql`drop function if exists public.test_fail_address()`);
    }

    expect(await orgsOf(user.id)).toHaveLength(0);
    const orphanOrgs = await getDb()
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.city, "FAIL-CITY"));
    expect(orphanOrgs).toHaveLength(0);
  });
});

describe("organization invariants in the database", () => {
  it("does not allow an organization's type to change", async () => {
    const user = await createAuthUser();
    const { orgId } = await createOrganizationForUser(user.id, supplierInput());
    await expect(
      getDb().update(organizations).set({ type: "buyer", businessType: "cafe" }).where(eq(organizations.id, orgId)),
    ).rejects.toThrow();
  });

  it("keeps a legal ID unique per kind in the database itself", async () => {
    const legalId = randomLegalId();
    const first = await createOrganizationForUser((await createAuthUser()).id, buyerInput({ legalId }));
    const second = await createOrganizationForUser((await createAuthUser()).id, buyerInput());
    await expect(
      getDb().update(organizations).set({ legalId }).where(eq(organizations.id, second.orgId)),
    ).rejects.toThrow();
    expect(first.orgId).not.toBe(second.orgId);
  });
});

describe("a business that buys and resells has both sides", () => {
  const sameBusiness = (legalId: string) => ({
    legalId,
    businessName: "[TEST] Reseller",
    contactName: "Gela",
    phone: "599 11 22 33",
    city: "თბილისი",
  });

  it("adds the other side at once when the first side is active and the legal ID is the same", async () => {
    const user = await createAuthUser();
    const legalId = randomLegalId();
    await createOrganizationForUser(user.id, buyerInput({ legalId }), { preapprovedLegalId: legalId });
    const added = await createOrganizationForUser(user.id, supplierInput({ legalId }), { addSide: true });
    expect(added.status).toBe("active");
    const orgs = await orgsOf(user.id);
    expect(orgs.map((o) => o.org.type).sort()).toEqual(["buyer", "supplier"]);
    expect(orgs.every((o) => o.org.legalId === legalId)).toBe(true);
    // The supplier side starts with its settings row, like any supplier.
    const [settings] = await getDb().select().from(supplierSettings).where(eq(supplierSettings.organizationId, added.orgId));
    expect(settings).toBeDefined();
  });

  it("waits for review when the first side is not active yet, or the legal ID differs", async () => {
    const waiting = await createAuthUser();
    const id = randomLegalId();
    await createOrganizationForUser(waiting.id, buyerInput({ legalId: id }));
    expect((await createOrganizationForUser(waiting.id, supplierInput({ legalId: id }), { addSide: true })).status).toBe("pending_review");

    const other = await createAuthUser();
    const first = randomLegalId();
    await createOrganizationForUser(other.id, buyerInput({ legalId: first }), { preapprovedLegalId: first });
    expect((await createOrganizationForUser(other.id, supplierInput({ legalId: randomLegalId() }), { addSide: true })).status).toBe("pending_review");
  });

  it("refuses a side the person already has, and adding a side before any organization exists", async () => {
    const user = await createAuthUser();
    await expect(createOrganizationForUser(user.id, supplierInput(), { addSide: true })).rejects.toEqual(new OnboardingError("not_onboarded"));
    await createOrganizationForUser(user.id, buyerInput());
    await expect(createOrganizationForUser(user.id, buyerInput(), { addSide: true })).rejects.toEqual(new OnboardingError("already_has_kind"));
    // Without addSide a second organization is still refused (one onboarding per person).
    await expect(createOrganizationForUser(user.id, supplierInput())).rejects.toEqual(new OnboardingError("already_onboarded"));
  });

  it("creates both sides together, both active when vetted and both waiting otherwise", async () => {
    const vetted = await createAuthUser();
    const id = randomLegalId();
    const common = sameBusiness(id);
    const result = await createBothForUser(
      vetted.id,
      { kind: "buyer", ...common, businessType: "retailer", addressLine: "Rustaveli 5", deliveryInstructions: undefined },
      { kind: "supplier", ...common, deliveryArea: "Tbilisi" },
      { preapprovedLegalId: id },
    );
    expect([result.buyer.status, result.supplier.status]).toEqual(["active", "active"]);
    expect((await orgsOf(vetted.id)).length).toBe(2);

    const unvetted = await createAuthUser();
    const both = await createBothForUser(
      unvetted.id,
      { kind: "buyer", ...sameBusiness(randomLegalId()), businessType: "retailer", addressLine: "Rustaveli 5", deliveryInstructions: undefined },
      { kind: "supplier", ...sameBusiness(randomLegalId()), deliveryArea: "Tbilisi" },
    );
    expect([both.buyer.status, both.supplier.status]).toEqual(["pending_review", "pending_review"]);
  });

  it("rolls back both sides when one cannot be created", async () => {
    const user = await createAuthUser();
    const legalId = randomLegalId();
    // Someone else already has a supplier with this legal ID.
    const rival = await createAuthUser();
    await createOrganizationForUser(rival.id, supplierInput({ legalId }));
    await expect(
      createBothForUser(
        user.id,
        { kind: "buyer", ...sameBusiness(legalId), businessType: "retailer", addressLine: "Rustaveli 5", deliveryInstructions: undefined },
        { kind: "supplier", ...sameBusiness(legalId), deliveryArea: "Tbilisi" },
      ),
    ).rejects.toEqual(new OnboardingError("legal_id_taken"));
    expect(await orgsOf(user.id)).toHaveLength(0);
  });
});
