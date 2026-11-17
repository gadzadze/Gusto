import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { addresses, orderWaybills, organizations, rsConnections } from "@/server/db/schema";
import type { OrgCtx, SupplierCtx } from "@/server/domain/context";
import { StateError } from "@/server/domain/errors";
import { getCart, setCartQuantity } from "@/server/domain/orders/cart";
import { submitOrder } from "@/server/domain/orders/submit";
import { confirmOrder } from "@/server/domain/orders/transitions";
import { activateWaybill, closeWaybill, connectRs, disconnectRs, discardDraft, getOrderWaybill, getRsStatus, readWaybillAtRs, saveWaybillDraft } from "@/server/domain/waybills/rsge";
import { RsError, type RsApi } from "@/server/rsge/client";
import { connectBuyer, createAdmin, createBuyer, createSupplier, createTestCategory, createTestProduct } from "./helpers";

let categoryId: string;
const saved = { enabled: process.env.RSGE_ENABLED, key: process.env.RSGE_ENCRYPTION_KEY };
beforeAll(async () => {
  process.env.RSGE_ENABLED = "1";
  process.env.RSGE_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  categoryId = (await createTestCategory(await createAdmin())).id;
});
afterAll(() => {
  if (saved.enabled === undefined) delete process.env.RSGE_ENABLED;
  else process.env.RSGE_ENABLED = saved.enabled;
  if (saved.key === undefined) delete process.env.RSGE_ENCRYPTION_KEY;
  else process.env.RSGE_ENCRYPTION_KEY = saved.key;
});

/** A fake RS.ge that records calls; `tin` is the tax id it reports for the service user. */
function fakeRs(tin: string, overrides: Partial<RsApi> = {}) {
  const calls: string[] = [];
  const api = {
    checkServiceUser: async (c) => (c.sp === "good" ? { payerId: 11, serviceUserId: 3 } : null),
    tinFromUnId: async () => tin,
    units: async () => [{ id: 9, name: "ბოთლი" }, { id: 1, name: "ცალი" }, { id: 99, name: "სხვა" }],
    saveWaybill: async () => (calls.push("save"), 555),
    sendWaybill: async () => (calls.push("send"), "0000012345"),
    closeWaybill: async () => void calls.push("close"),
    deleteWaybill: async () => void calls.push("delete"),
    getWaybill: async () => "<WAYBILL><ID>555</ID></WAYBILL>",
    ...overrides,
  } as RsApi;
  return { api, calls };
}

async function legalIdOf(ctx: OrgCtx) {
  const [row] = await getDb().select({ legalId: organizations.legalId }).from(organizations).where(eq(organizations.id, ctx.orgId));
  return row.legalId!;
}

async function placeConfirmedOrder(supplier: SupplierCtx, bottles = 24000) {
  const buyer = await createBuyer();
  await connectBuyer(supplier, buyer);
  const wine = await createTestProduct(supplier, categoryId, { name: "[TEST] Wine", basePrice: "18", unit: "bottle" });
  await setCartQuantity(buyer, supplier.orgId, wine, bottles);
  const cart = await getCart(buyer, supplier.orgId);
  const [address] = await getDb().select({ id: addresses.id }).from(addresses).where(eq(addresses.organizationId, buyer.orgId));
  const placed = await submitOrder(buyer, supplier.orgId, {
    idempotencyKey: randomUUID(),
    expected: cart.lines.map((l) => ({ productId: l.productId, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor })),
    addressId: address.id,
  });
  if (placed.status === "changed") throw new Error("unexpected change");
  await confirmOrder(supplier, placed.orderId, []);
  return placed.orderId;
}

const transport = { startAddress: "Warehouse 1, Tbilisi", driverName: "Giorgi", driverId: "01010101010", vehicle: "AB-123-CD" };

describe("RS.ge connection", () => {
  it("connects only with credentials RS.ge accepts that belong to this company, and stores them encrypted", async () => {
    const supplier = await createSupplier();
    const tin = await legalIdOf(supplier);
    expect((await getRsStatus(supplier)).connected).toBe(false);

    await expect(connectRs(supplier, "su1", "bad", fakeRs(tin).api)).rejects.toEqual(new StateError("invalid_credentials"));
    // Credentials of another taxpayer are refused.
    await expect(connectRs(supplier, "su1", "good", fakeRs("999999999").api)).rejects.toEqual(new StateError("wrong_company"));
    expect((await getRsStatus(supplier)).connected).toBe(false);

    await connectRs(supplier, "su1", "good", fakeRs(tin).api);
    expect(await getRsStatus(supplier)).toMatchObject({ enabled: true, connected: true });
    const [row] = await getDb().select().from(rsConnections).where(eq(rsConnections.organizationId, supplier.orgId));
    expect(row.suCipher).not.toContain("su1");
    expect(row.spCipher).not.toContain("good");
    expect(row).toMatchObject({ payerId: 11, serviceUserId: 3 });

    await disconnectRs(supplier);
    expect((await getRsStatus(supplier)).connected).toBe(false);
  });

  it("is off without the flag, and RS.ge being unreachable is reported, not hidden", async () => {
    const supplier = await createSupplier();
    const tin = await legalIdOf(supplier);
    await expect(connectRs(supplier, "su1", "good", fakeRs(tin, { checkServiceUser: async () => { throw new RsError("unreachable", "x"); } }).api)).rejects.toEqual(new StateError("rs_unreachable"));
    process.env.RSGE_ENABLED = "0";
    try {
      expect((await getRsStatus(supplier)).enabled).toBe(false);
      await expect(connectRs(supplier, "su1", "good", fakeRs(tin).api)).rejects.toEqual(new StateError("disabled"));
    } finally {
      process.env.RSGE_ENABLED = "1";
    }
  });
});

describe("waybill steps", () => {
  it("saves a draft, activates it once, closes it, and never sends twice", async () => {
    const supplier = await createSupplier();
    const tin = await legalIdOf(supplier);
    await connectRs(supplier, "su1", "good", fakeRs(tin).api);
    const orderId = await placeConfirmedOrder(supplier);
    const { api, calls } = fakeRs(tin);

    await expect(activateWaybill(supplier, orderId, api)).rejects.toThrow(); // nothing saved yet
    await expect(saveWaybillDraft(supplier, orderId, { ...transport, vehicle: "" }, api)).rejects.toEqual(new StateError("invalid_transport"));
    expect(await saveWaybillDraft(supplier, orderId, transport, api)).toEqual({ rsWaybillId: 555 });
    expect(await getOrderWaybill(supplier, orderId)).toMatchObject({ status: "draft", rsWaybillId: 555, vehicle: "AB-123-CD" });
    await expect(saveWaybillDraft(supplier, orderId, transport, api)).rejects.toEqual(new StateError("already_exists"));
    expect(await readWaybillAtRs(supplier, orderId, api)).toContain("<ID>555</ID>");
    await expect(closeWaybill(supplier, orderId, api)).rejects.toEqual(new StateError("not_active"));

    // Two clicks at once: only one reaches RS.ge.
    const results = await Promise.allSettled([activateWaybill(supplier, orderId, api), activateWaybill(supplier, orderId, api)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(calls.filter((c) => c === "send")).toHaveLength(1);
    expect(await getOrderWaybill(supplier, orderId)).toMatchObject({ status: "active", rsNumber: "0000012345" });
    await expect(discardDraft(supplier, orderId, api)).rejects.toEqual(new StateError("not_draft"));

    await closeWaybill(supplier, orderId, api);
    expect((await getOrderWaybill(supplier, orderId))?.status).toBe("closed");
  });

  it("a refused draft leaves nothing behind, a discarded draft can be redone, and other companies see nothing", async () => {
    const supplier = await createSupplier();
    const other = await createSupplier();
    const tin = await legalIdOf(supplier);
    await connectRs(supplier, "su1", "good", fakeRs(tin).api);
    const orderId = await placeConfirmedOrder(supplier);

    const refuse = fakeRs(tin, { saveWaybill: async () => { throw new RsError("rejected", "no"); } });
    await expect(saveWaybillDraft(supplier, orderId, transport, refuse.api)).rejects.toEqual(new StateError("rs_rejected"));
    expect(await getOrderWaybill(supplier, orderId)).toBeNull();

    const { api, calls } = fakeRs(tin);
    await saveWaybillDraft(supplier, orderId, transport, api);
    await discardDraft(supplier, orderId, api);
    expect(calls).toEqual(["save", "delete"]);
    expect(await getOrderWaybill(supplier, orderId)).toBeNull();
    await saveWaybillDraft(supplier, orderId, transport, api);

    // Another company: not connected, and the order is not theirs.
    await expect(saveWaybillDraft(other, orderId, transport, api)).rejects.toEqual(new StateError("not_connected"));
    expect((await getDb().select().from(orderWaybills).where(eq(orderWaybills.orderId, orderId))).length).toBe(1);
  });

  it("refuses what it cannot represent (a unit RS.ge has no name for, no 'other')", async () => {
    const supplier = await createSupplier();
    const tin = await legalIdOf(supplier);
    await connectRs(supplier, "su1", "good", fakeRs(tin).api);
    const orderId = await placeConfirmedOrder(supplier);
    const noOther = fakeRs(tin, { units: async () => [{ id: 1, name: "ცალი" }] });
    await expect(saveWaybillDraft(supplier, orderId, transport, noOther.api)).rejects.toEqual(new StateError("unit_unmapped"));
    expect(noOther.calls).not.toContain("save");
  });
});
