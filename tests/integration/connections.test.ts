import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { connectionRequests, organizations, supplierCustomers } from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";
import {
  decideConnectionRequest,
  findBusinessByCode,
  listConnectionRequests,
  sendConnectionRequest,
  setFindable,
  withdrawConnectionRequest,
} from "@/server/domain/connections/connections";
import { setCustomerBlocked } from "@/server/domain/customers/customers";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { createPriceList, setDefaultPriceList } from "@/server/domain/pricing/price-lists";
import { listNotifications } from "@/server/notifications/queries";
import { createBuyer, createSupplier } from "./helpers";

async function legalIdOf(ctx: OrgCtx): Promise<string> {
  const [row] = await getDb().select({ legalId: organizations.legalId }).from(organizations).where(eq(organizations.id, ctx.orgId));
  return row.legalId!;
}

async function connection(supplier: OrgCtx, buyer: OrgCtx) {
  const [row] = await getDb()
    .select()
    .from(supplierCustomers)
    .where(and(eq(supplierCustomers.supplierOrgId, supplier.orgId), eq(supplierCustomers.buyerOrgId, buyer.orgId)));
  return row;
}

async function found(ctx: OrgCtx, code: string) {
  const result = await findBusinessByCode(ctx, code);
  if (result.state !== "found") throw new Error(`expected found, got ${result.state}`);
  return result;
}

describe("looking a business up by its code", () => {
  it("answers with the name and city only, and treats every unavailable business like a missing one", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const hit = await found(supplier, await legalIdOf(buyer));
    expect(Object.keys(hit).sort()).toEqual(["city", "name", "orgId", "relation", "requestId", "customerId", "state"].filter((k) => k in hit).sort());
    expect(hit.relation).toBe("none");

    // Wrong shape is refused, an unknown code is "not found".
    await expect(findBusinessByCode(supplier, "12345")).rejects.toEqual(new StateError("invalid_code"));
    expect(await findBusinessByCode(supplier, "000000000")).toEqual({ state: "not_found" });
    // Spaces and dashes people paste in are ignored.
    const code = await legalIdOf(buyer);
    expect((await findBusinessByCode(supplier, ` ${code.slice(0, 3)}-${code.slice(3)} `)).state).toBe("found");

    // A buyer is found by a supplier, never by another buyer: the type decides who is searched.
    const otherBuyer = await createBuyer();
    expect(await findBusinessByCode(otherBuyer, code)).toEqual({ state: "not_found" });

    // Not findable and not yet approved answer exactly like a business that does not exist.
    await setFindable(buyer, false);
    expect(await findBusinessByCode(supplier, code)).toEqual({ state: "not_found" });
    await setFindable(buyer, true);
    const waiting = await createBuyer("pending_review");
    expect(await findBusinessByCode(supplier, await legalIdOf(waiting))).toEqual({ state: "not_found" });

    // An organization that is not approved cannot look anyone up.
    const pendingSupplier = await createSupplier("pending_review");
    await expect(findBusinessByCode(pendingSupplier, code)).rejects.toEqual(new StateError("not_active"));
  });
});

describe("connecting without a link", () => {
  it("a supplier asks, the buyer approves, and the supplier's default list applies", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const listId = await createPriceList(supplier, "Default");
    await setDefaultPriceList(supplier, listId);

    const hit = await found(supplier, await legalIdOf(buyer));
    const sent = await sendConnectionRequest(supplier, hit.orgId, { message: "Hello" });
    expect(sent.status).toBe("sent");
    expect((await found(supplier, await legalIdOf(buyer))).relation).toBe("pending_outgoing");
    expect((await found(buyer, await legalIdOf(supplier))).relation).toBe("pending_incoming");

    // Nothing is visible before the answer.
    expect(await connection(supplier, buyer)).toBeUndefined();
    const inbox = await listConnectionRequests(buyer);
    expect(inbox.incoming).toHaveLength(1);
    expect(inbox.incoming[0].message).toBe("Hello");
    expect((await listConnectionRequests(supplier)).outgoing).toHaveLength(1);

    // The buyer is told (link to the requests), the one who asked is not.
    const told = (await listNotifications(buyer.userId)).items.find((n) => n.event === "connection_requested");
    expect(told?.link).toBe("/buyer/suppliers#requests");
    expect((await listNotifications(supplier.userId)).items.some((n) => n.event === "connection_requested")).toBe(false);

    // Neither the one who asked nor another business can answer it.
    await expect(decideConnectionRequest(supplier, inbox.incoming[0].id, true)).rejects.toBeInstanceOf(NotFoundError);
    const stranger = await createBuyer();
    await expect(decideConnectionRequest(stranger, inbox.incoming[0].id, true)).rejects.toBeInstanceOf(NotFoundError);

    const result = await decideConnectionRequest(buyer, inbox.incoming[0].id, true);
    const row = await connection(supplier, buyer);
    expect(row).toMatchObject({ status: "active", priceListId: listId });
    expect(result.customerId).toBe(row.id);
    const answer = (await listNotifications(supplier.userId)).items.find((n) => n.event === "connection_approved");
    expect(answer?.link).toBe(`/supplier/customers/${row.id}`);
    expect((await found(supplier, await legalIdOf(buyer))).relation).toBe("connected");
    await expect(sendConnectionRequest(supplier, hit.orgId)).rejects.toEqual(new StateError("already_connected"));
    // Answered requests cannot be answered twice.
    await expect(decideConnectionRequest(buyer, inbox.incoming[0].id, true)).rejects.toEqual(new StateError("request_not_pending"));
  });

  it("a buyer asks, the supplier approves with a list of its own, and only its own", async () => {
    const supplier = await createSupplier();
    const other = await createSupplier();
    const buyer = await createBuyer();
    const mine = await createPriceList(supplier, "Restaurants");
    const theirs = await createPriceList(other, "Theirs");

    await sendConnectionRequest(buyer, (await found(buyer, await legalIdOf(supplier))).orgId);
    const [request] = (await listConnectionRequests(supplier)).incoming;
    // A list from another supplier is refused and the request stays open.
    await expect(decideConnectionRequest(supplier, request.id, true, { priceListId: theirs })).rejects.toEqual(new StateError("invalid_list"));
    expect((await listConnectionRequests(supplier)).incoming).toHaveLength(1);
    await decideConnectionRequest(supplier, request.id, true, { priceListId: mine });
    expect(await connection(supplier, buyer)).toMatchObject({ status: "active", priceListId: mine });
    expect((await listNotifications(buyer.userId)).items.find((n) => n.event === "connection_approved")?.link).toBe(`/buyer/suppliers/${supplier.orgId}`);

    // A buyer cannot offer a list.
    const buyer2 = await createBuyer();
    const hit = await found(buyer2, await legalIdOf(supplier));
    await expect(sendConnectionRequest(buyer2, hit.orgId, { priceListId: mine })).rejects.toEqual(new StateError("invalid_list"));
    // A supplier cannot offer another supplier's list.
    await expect(sendConnectionRequest(supplier, (await found(supplier, await legalIdOf(buyer2))).orgId, { priceListId: theirs })).rejects.toEqual(new StateError("invalid_list"));
  });

  it("a declined request cools down, can be withdrawn, and one that is answered back connects at once", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const target = (await found(buyer, await legalIdOf(supplier))).orgId;

    await sendConnectionRequest(buyer, target);
    await expect(sendConnectionRequest(buyer, target)).rejects.toEqual(new StateError("already_pending"));
    const [asked] = (await listConnectionRequests(buyer)).outgoing;
    await withdrawConnectionRequest(buyer, asked.id);
    await expect(withdrawConnectionRequest(buyer, asked.id)).rejects.toBeInstanceOf(NotFoundError);
    // Only the one who asked can withdraw.
    await sendConnectionRequest(buyer, target);
    const [open] = (await listConnectionRequests(supplier)).incoming;
    await expect(withdrawConnectionRequest(supplier, open.id)).rejects.toBeInstanceOf(NotFoundError);

    await decideConnectionRequest(supplier, open.id, false);
    expect((await listNotifications(buyer.userId)).items.some((n) => n.event === "connection_declined")).toBe(true);
    expect((await found(buyer, await legalIdOf(supplier))).relation).toBe("cooldown");
    await expect(sendConnectionRequest(buyer, target)).rejects.toEqual(new StateError("declined_recently"));
    expect(await connection(supplier, buyer)).toBeUndefined();

    // The other direction is not held back by it, and agreeing to a request that is already open connects.
    const supplier2 = await createSupplier();
    const buyer2 = await createBuyer();
    await sendConnectionRequest(supplier2, (await found(supplier2, await legalIdOf(buyer2))).orgId);
    const back = await sendConnectionRequest(buyer2, supplier2.orgId);
    expect(back.status).toBe("connected");
    expect(await connection(supplier2, buyer2)).toMatchObject({ status: "active" });
  });

  it("closes requests that ran out, and keeps a blocked buyer out without telling it", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await sendConnectionRequest(buyer, supplier.orgId);
    const [request] = (await listConnectionRequests(supplier)).incoming;
    await getDb().update(connectionRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(connectionRequests.id, request.id));
    expect((await listConnectionRequests(supplier)).incoming).toHaveLength(0);
    await expect(decideConnectionRequest(supplier, request.id, true)).rejects.toEqual(new StateError("request_not_pending"));
    // An expired request does not block a new one.
    expect((await sendConnectionRequest(buyer, supplier.orgId)).status).toBe("sent");

    // Block: the supplier sees it; the buyer finds nothing and cannot ask.
    const [second] = (await listConnectionRequests(supplier)).incoming;
    await decideConnectionRequest(supplier, second.id, true);
    const row = await connection(supplier, buyer);
    await setCustomerBlocked(supplier, row.id, true);
    expect((await found(supplier, await legalIdOf(buyer))).relation).toBe("blocked_by_you");
    expect(await findBusinessByCode(buyer, await legalIdOf(supplier))).toEqual({ state: "not_found" });
    await expect(sendConnectionRequest(buyer, supplier.orgId)).rejects.toEqual(new StateError("not_found"));
    await expect(sendConnectionRequest(supplier, buyer.orgId)).rejects.toEqual(new StateError("blocked"));
  });

  it("a business that switched findable off cannot be asked, even by its id", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const id = (await found(buyer, await legalIdOf(supplier))).orgId;
    await setFindable(supplier, false);
    await expect(sendConnectionRequest(buyer, id)).rejects.toEqual(new StateError("not_found"));
    // Two businesses of the same kind, or an id that is no business, are refused the same way.
    await expect(sendConnectionRequest(buyer, (await createBuyer()).orgId)).rejects.toEqual(new StateError("not_found"));
    await expect(sendConnectionRequest(buyer, "not-an-id")).rejects.toEqual(new StateError("not_found"));
    await expect(sendConnectionRequest(buyer, "00000000-0000-0000-0000-000000000000")).rejects.toEqual(new StateError("not_found"));
  });
});

