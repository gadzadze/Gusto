import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { buyerSupplierInvites, connectionRequests, invitations, organizations, supplierCustomers } from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";
import { convertOpenInvitations } from "@/server/domain/connections/convert";
import { decideConnectionRequest, setFindable } from "@/server/domain/connections/connections";
import { createCustomer } from "@/server/domain/customers/customers";
import { acceptInvitationAsBuyer } from "@/server/domain/customers/invitations";
import { createSupplierInvite } from "@/server/domain/buyer/supplier-invites";
import { customerSchema } from "@/lib/validation/customer";
import { supplierInviteSchema } from "@/lib/validation/supplier-invite";
import { createBuyer, createSupplier } from "./helpers";

let counter = 0;
const newCode = () => String(700000000 + Date.now() % 100000 * 100 + counter++ % 100).slice(0, 9);

async function setCode(ctx: OrgCtx, code: string) {
  await getDb().update(organizations).set({ legalId: code }).where(eq(organizations.id, ctx.orgId));
}

const customerValues = (code: string) =>
  customerSchema.parse({ businessName: "[TEST] Invited cafe", phone: "599 11 22 33", legalId: code, priceListId: "" });

async function requestsBetween(a: OrgCtx, b: OrgCtx) {
  return getDb()
    .select()
    .from(connectionRequests)
    .where(and(eq(connectionRequests.fromOrgId, a.orgId), eq(connectionRequests.toOrgId, b.orgId)));
}

describe("invitations with a code become connection requests", () => {
  it("validates the code on both forms", () => {
    expect(customerValues("205 123 456").legalId).toBe("205123456");
    expect(customerSchema.safeParse({ businessName: "x", phone: "599 11 22 33", legalId: "123" }).success).toBe(false);
    expect(supplierInviteSchema.parse({ supplierName: "x", phone: "599 11 22 33", legalId: "" }).legalId).toBeNull();
  });

  it("a supplier's invitation turns into a request when the buyer with that code is active, once", async () => {
    const supplier = await createSupplier();
    const code = newCode();
    const { customerId } = await createCustomer(supplier, customerValues(code));
    const buyer = await createBuyer();
    await setCode(buyer, code);

    expect(await convertOpenInvitations(buyer.orgId)).toBe(1);
    expect(await convertOpenInvitations(buyer.orgId)).toBe(0);
    const [request] = await requestsBetween(supplier, buyer);
    expect(request.status).toBe("pending");
    expect(request.customerId).toBe(customerId);

    // Approving connects the invited row: the supplier keeps one customer, and the link stops working.
    await decideConnectionRequest(buyer, request.id, true);
    const rows = await getDb().select().from(supplierCustomers).where(eq(supplierCustomers.supplierOrgId, supplier.orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: customerId, buyerOrgId: buyer.orgId, status: "active", businessName: "[TEST] Invited cafe" });
    const links = await getDb().select().from(invitations).where(eq(invitations.supplierCustomerId, customerId));
    expect(links.every((l) => l.revokedAt !== null)).toBe(true);
  });

  it("a buyer's invitation turns into a request in the supplier's inbox", async () => {
    const buyer = await createBuyer();
    const code = newCode();
    const { inviteId } = await createSupplierInvite(buyer, supplierInviteSchema.parse({ supplierName: "[TEST] S", phone: "599 11 22 33", legalId: code }));
    const supplier = await createSupplier();
    await setCode(supplier, code);

    expect(await convertOpenInvitations(supplier.orgId)).toBe(1);
    const [request] = await requestsBetween(buyer, supplier);
    expect(request.status).toBe("pending");
    const [invite] = await getDb().select().from(buyerSupplierInvites).where(eq(buyerSupplierInvites.id, inviteId));
    expect(invite.convertedAt).not.toBeNull();
  });

  it("does nothing for a business that is not findable, blocked, or not matching", async () => {
    const supplier = await createSupplier();
    const code = newCode();
    await createCustomer(supplier, customerValues(code));
    const hidden = await createBuyer();
    await setCode(hidden, code);
    await setFindable(hidden, false);
    expect(await convertOpenInvitations(hidden.orgId)).toBe(0);
    expect(await requestsBetween(supplier, hidden)).toHaveLength(0);
    // Switching it on later lets the same invitation through.
    await setFindable(hidden, true);
    expect(await convertOpenInvitations(hidden.orgId)).toBe(1);

    const other = await createBuyer();
    expect(await convertOpenInvitations(other.orgId)).toBe(0);
  });

  it("skips invitations that were revoked, and pairs that are blocked", async () => {
    const supplier = await createSupplier();
    const code = newCode();
    const { customerId } = await createCustomer(supplier, customerValues(code));
    await getDb().update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.supplierCustomerId, customerId));
    const buyer = await createBuyer();
    await setCode(buyer, code);
    expect(await convertOpenInvitations(buyer.orgId)).toBe(0);

    const supplier2 = await createSupplier();
    const code2 = newCode();
    const { customerId: blockedId } = await createCustomer(supplier2, customerValues(code2));
    const buyer2 = await createBuyer();
    await setCode(buyer2, code2);
    // A blocked row for this very pair means no request, even though an invitation is open for the code.
    await getDb().insert(supplierCustomers).values({ supplierOrgId: supplier2.orgId, buyerOrgId: buyer2.orgId, status: "blocked", businessName: "x" });
    expect(await convertOpenInvitations(buyer2.orgId)).toBe(0);
    expect(blockedId).toBeTruthy();
  });

  it("using the link settles a request that was waiting", async () => {
    const supplier = await createSupplier();
    const code = newCode();
    const { token } = await createCustomer(supplier, customerValues(code));
    const buyer = await createBuyer();
    await setCode(buyer, code);
    await convertOpenInvitations(buyer.orgId);
    await acceptInvitationAsBuyer(buyer, token);
    const [request] = await requestsBetween(supplier, buyer);
    expect(request.status).toBe("approved");
  });
});
