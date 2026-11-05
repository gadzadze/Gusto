import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { onboardingSchema } from "@/lib/validation/onboarding";
import { supplierInviteSchema } from "@/lib/validation/supplier-invite";
import { getDb } from "@/server/db/client";
import { buyerSupplierInvites, supplierCustomers, supplierRequests } from "@/server/db/schema";
import { createSupplierRequest, reviewSupplierRequest } from "@/server/domain/admin/supplier-requests";
import {
  connectInvitingBuyer,
  createSupplierInvite,
  listInvitingBuyers,
  listSupplierInvites,
  previewSupplierInvite,
  revokeSupplierInvite,
} from "@/server/domain/buyer/supplier-invites";
import type { AdminCtx } from "@/server/domain/context";
import { StateError } from "@/server/domain/errors";
import { createOrganizationForUser } from "@/server/domain/onboarding/create-organization";
import { setDefaultPriceList, createPriceList } from "@/server/domain/pricing/price-lists";
import { createAdmin, createAuthUser, createBuyer, createSupplier, randomLegalId } from "./helpers";

let admin: AdminCtx;
beforeAll(async () => {
  admin = await createAdmin();
});

const invite = (name = "[TEST] Dairy") => supplierInviteSchema.parse({ supplierName: name, phone: "599 11 22 33", email: "" });
const requestFor = (email: string, legalId = randomLegalId()) => ({
  businessName: "[TEST] Dairy Ltd",
  legalId,
  contactName: "Gela",
  phone: "+995599112233",
  email,
  city: "Tbilisi",
  note: undefined,
});

describe("a buyer invites a supplier", () => {
  it("needs a phone or an email, and only an active buyer can invite", async () => {
    expect(supplierInviteSchema.safeParse({ supplierName: "X", phone: "", email: "" }).success).toBe(false);
    const pending = await createBuyer("pending_review");
    await expect(createSupplierInvite(pending, invite())).rejects.toEqual(new StateError("not_active"));
    const supplier = await createSupplier();
    await expect(createSupplierInvite(supplier, invite())).rejects.toThrow(); // suppliers are not buyers
  });

  it("opens the join page with the names, for exactly one request, and never for a bad link", async () => {
    const buyer = await createBuyer();
    const { token } = await createSupplierInvite(buyer, invite("[TEST] Cheese House"));
    expect(await previewSupplierInvite(token)).toMatchObject({ supplierName: "[TEST] Cheese House" });
    expect(await previewSupplierInvite("x".repeat(43))).toBeNull();
    expect(await previewSupplierInvite("short")).toBeNull();

    // A duplicate request does not use the link up.
    const email = `dairy-${randomLegalId()}@test.gusto.ge`;
    const legalId = randomLegalId();
    expect(await createSupplierRequest(requestFor(email, legalId), token)).toBe("created");
    expect(await createSupplierRequest(requestFor(email, legalId), token)).toBe("duplicate");
    // The first one claimed it: the link is single use now.
    expect(await previewSupplierInvite(token)).toBeNull();
    const second = await createSupplierRequest(requestFor(`other-${randomLegalId()}@test.gusto.ge`), token);
    expect(second).toBe("created");
    const [row] = await getDb().select().from(supplierRequests).where(eq(supplierRequests.email, email));
    expect(row.inviteId).not.toBeNull();
    const plain = await getDb().select().from(supplierRequests).where(eq(supplierRequests.businessName, "[TEST] Dairy Ltd"));
    expect(plain.filter((r) => r.inviteId !== null)).toHaveLength(1);
  });

  it("a revoked link stops working, and only the buyer's own open links can be revoked", async () => {
    const buyer = await createBuyer();
    const other = await createBuyer();
    const { token, inviteId } = await createSupplierInvite(buyer, invite());
    await expect(revokeSupplierInvite(other, inviteId)).rejects.toEqual(new StateError("stale_status"));
    await revokeSupplierInvite(buyer, inviteId);
    expect(await previewSupplierInvite(token)).toBeNull();
    expect((await listSupplierInvites(buyer))[0].state).toBe("revoked");
  });

  it("from invitation to a connected customer, with the supplier in control", async () => {
    const buyer = await createBuyer();
    const { token, inviteId } = await createSupplierInvite(buyer, invite("[TEST] Bakery"));
    const email = `bakery-${randomLegalId()}@test.gusto.ge`;
    const legalId = randomLegalId();
    await createSupplierRequest(requestFor(email, legalId), token);
    expect((await listSupplierInvites(buyer))[0]).toMatchObject({ state: "joined", requestStatus: "new" });

    // The admin approves; the supplier signs in with that address and onboards.
    const [req] = await getDb().select().from(supplierRequests).where(eq(supplierRequests.email, email));
    await reviewSupplierRequest(admin, req.id, "approve");
    expect((await listSupplierInvites(buyer))[0]).toMatchObject({ state: "joined", requestStatus: "approved" });
    const user = await createAuthUser(email);
    const { orgId } = await createOrganizationForUser(
      user.id,
      onboardingSchema.parse({ kind: "supplier", businessName: "[TEST] Bakery Ltd", legalId, contactName: "Gela", phone: "599 11 22 33", city: "Tbilisi", deliveryArea: "Tbilisi" }),
      { preapprovedLegalId: legalId, signInEmail: email },
    );
    const supplier = { userId: user.id, orgId, orgType: "supplier" as const, orgStatus: "active" as const };

    // The buyer is offered to the supplier, who has not agreed to anything yet.
    const offered = await listInvitingBuyers(supplier);
    expect(offered.map((o) => o.inviteId)).toEqual([inviteId]);
    expect(await getDb().select().from(supplierCustomers).where(eq(supplierCustomers.supplierOrgId, orgId))).toHaveLength(0);

    // Another supplier can't take it.
    const stranger = await createSupplier();
    await expect(connectInvitingBuyer(stranger, inviteId)).rejects.toThrow();

    // The supplier's default list is used for the new customer.
    const list = await createPriceList(supplier, "Default");
    await setDefaultPriceList(supplier, list);
    const { customerId } = await connectInvitingBuyer(supplier, inviteId);
    const [customer] = await getDb().select().from(supplierCustomers).where(eq(supplierCustomers.id, customerId));
    expect(customer).toMatchObject({ supplierOrgId: orgId, buyerOrgId: buyer.orgId, status: "active", priceListId: list });
    expect((await listSupplierInvites(buyer))[0].state).toBe("connected");
    expect(await listInvitingBuyers(supplier)).toEqual([]);
    await expect(connectInvitingBuyer(supplier, inviteId)).rejects.toEqual(new StateError("already_connected"));
    const [stored] = await getDb().select().from(buyerSupplierInvites).where(eq(buyerSupplierInvites.id, inviteId));
    expect(stored.supplierOrgId).toBe(orgId);
  });

  it("an invitation is only attached to the supplier whose approved request carried it", async () => {
    const buyer = await createBuyer();
    const { token, inviteId } = await createSupplierInvite(buyer, invite());
    const email = `x-${randomLegalId()}@test.gusto.ge`;
    await createSupplierRequest(requestFor(email), token);
    // Not approved yet: someone signing in with that address gets nothing attached.
    const user = await createAuthUser(email);
    const legalId = randomLegalId();
    const { orgId } = await createOrganizationForUser(
      user.id,
      onboardingSchema.parse({ kind: "supplier", businessName: "[TEST] Early", legalId, contactName: "G", phone: "599 11 22 33", city: "Tbilisi", deliveryArea: "Tbilisi" }),
      { signInEmail: email },
    );
    const [stored] = await getDb().select().from(buyerSupplierInvites).where(eq(buyerSupplierInvites.id, inviteId));
    expect(stored.supplierOrgId).toBeNull();
    expect(await listInvitingBuyers({ userId: user.id, orgId, orgType: "supplier", orgStatus: "active" })).toEqual([]);
  });
});
