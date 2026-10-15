import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { addresses, organizations, rateLimits } from "@/server/db/schema";
import type { AdminCtx, OrgCtx, SupplierCtx } from "@/server/domain/context";
import { customerSchema } from "@/lib/validation/customer";
import { createCustomer, regenerateInvitation } from "@/server/domain/customers/customers";
import { setProductImage } from "@/server/domain/catalog/products";
import { StateError } from "@/server/domain/errors";
import { getCart, setCartQuantity } from "@/server/domain/orders/cart";
import { submitOrder } from "@/server/domain/orders/submit";
import { consumeRateLimit, pruneRateLimits, rateKey, RATE_LIMITS } from "@/server/security/rate-limit";
import { connectBuyer, createAdmin, createBuyer, createSupplier, createTestCategory, createTestProduct, memoryStorage } from "./helpers";

let admin: AdminCtx;
let categoryId: string;
beforeAll(async () => {
  admin = await createAdmin();
  categoryId = (await createTestCategory(admin)).id;
});

const limited = new StateError("rate_limited");

async function submitOnce(supplier: SupplierCtx, buyer: OrgCtx, productId: string) {
  await setCartQuantity(buyer, supplier.orgId, productId, 1000);
  const cart = await getCart(buyer, supplier.orgId);
  const [address] = await getDb().select({ id: addresses.id }).from(addresses).where(eq(addresses.organizationId, buyer.orgId));
  return submitOrder(buyer, supplier.orgId, {
    idempotencyKey: randomUUID(),
    expected: cart.lines.map((l) => ({ productId: l.productId, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor })),
    addressId: address.id,
  });
}

describe("consumeRateLimit", () => {
  const rule = { name: "test_rule", limit: 3, windowSeconds: 60 };

  it("allows up to the limit, then throws, per subject", async () => {
    const subject = randomUUID();
    for (let i = 0; i < 3; i++) await consumeRateLimit(rule, subject);
    await expect(consumeRateLimit(rule, subject)).rejects.toEqual(limited);
    await expect(consumeRateLimit(rule, subject)).rejects.toEqual(limited);
    await consumeRateLimit(rule, randomUUID()); // someone else is unaffected
  });

  it("starts a fresh window once the old one has passed", async () => {
    const subject = randomUUID();
    const t0 = new Date("2030-01-01T00:00:10Z");
    for (let i = 0; i < 3; i++) await consumeRateLimit(rule, subject, { now: t0 });
    await expect(consumeRateLimit(rule, subject, { now: new Date("2030-01-01T00:00:50Z") })).rejects.toEqual(limited);
    await consumeRateLimit(rule, subject, { now: new Date("2030-01-01T00:01:05Z") });
  });

  it("is safe under concurrency: exactly `limit` of N parallel attempts pass", async () => {
    const subject = randomUUID();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => consumeRateLimit(rule, subject)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(5);
  });

  it("hashes people-like subjects: the raw IP is never stored", async () => {
    const ip = "203.0.113.77";
    await consumeRateLimit(RATE_LIMITS.inviteAccept, ip, { hash: true });
    const rows = await getDb().select().from(rateLimits).where(eq(rateLimits.key, rateKey(RATE_LIMITS.inviteAccept, ip, { hash: true })));
    expect(rows).toHaveLength(1);
    const stored = await getDb().execute<{ key: string }>(sql`select key from rate_limits where key like 'invite_accept:%'`);
    expect([...stored].some((r) => r.key.includes(ip))).toBe(false);
  });

  it("invite acceptance allows 10 per minute per IP", async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}`;
    for (let i = 0; i < 10; i++) await consumeRateLimit(RATE_LIMITS.inviteAccept, ip, { hash: true });
    await expect(consumeRateLimit(RATE_LIMITS.inviteAccept, ip, { hash: true })).rejects.toEqual(limited);
  });

  it("prunes old windows only", async () => {
    await getDb().insert(rateLimits).values({ key: `prune:${randomUUID()}`, windowStart: new Date("2001-01-01T00:00:00Z"), hits: 1 });
    expect(await pruneRateLimits()).toBeGreaterThanOrEqual(1);
    await consumeRateLimit(rule, randomUUID());
    expect(await pruneRateLimits()).toBe(0);
  });
});

describe("limits on real actions", () => {
  it("order submit: the 11th new order within a minute is refused", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const product = await createTestProduct(supplier, categoryId, { basePrice: "1" });
    for (let i = 0; i < 10; i++) expect(await submitOnce(supplier, buyer, product)).toMatchObject({ status: "created" });
    await expect(submitOnce(supplier, buyer, product)).rejects.toEqual(limited);
  });

  it("order submit: a repeated idempotency key is not counted", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const product = await createTestProduct(supplier, categoryId, { basePrice: "1" });
    await setCartQuantity(buyer, supplier.orgId, product, 1000);
    const cart = await getCart(buyer, supplier.orgId);
    const [address] = await getDb().select({ id: addresses.id }).from(addresses).where(eq(addresses.organizationId, buyer.orgId));
    const input = {
      idempotencyKey: randomUUID(),
      expected: cart.lines.map((l) => ({ productId: l.productId, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor })),
      addressId: address.id,
    };
    const first = await submitOrder(buyer, supplier.orgId, input);
    for (let i = 0; i < 15; i++) expect(await submitOrder(buyer, supplier.orgId, input)).toMatchObject({ status: "existing" });
    expect(first.status).toBe("created");
  });

  it("invite creation: 30 per hour per supplier, regeneration included", async () => {
    const supplier = await createSupplier();
    for (let i = 0; i < 29; i++) {
      await createCustomer(supplier, customerSchema.parse({ businessName: `[TEST] C${i}`, phone: "555123456", priceListId: "" }));
    }
    const { customerId } = await createCustomer(supplier, customerSchema.parse({ businessName: "[TEST] C29", phone: "555123456", priceListId: "" }));
    await expect(regenerateInvitation(supplier, customerId)).rejects.toEqual(limited);
    await expect(
      createCustomer(supplier, customerSchema.parse({ businessName: "[TEST] C30", phone: "555123456", priceListId: "" })),
    ).rejects.toEqual(limited);
    // Another supplier is unaffected.
    const other = await createSupplier();
    await createCustomer(other, customerSchema.parse({ businessName: "[TEST] X", phone: "555123456", priceListId: "" }));
  });

  it("image upload: 30 per hour per supplier (checked before any image work)", async () => {
    const supplier = await createSupplier();
    const product = await createTestProduct(supplier, categoryId);
    const storage = memoryStorage();
    // Not an image: each attempt fails validation, but still counts.
    for (let i = 0; i < 30; i++) await expect(setProductImage(supplier, product, new Uint8Array([1, 2, 3]), storage)).rejects.not.toEqual(limited);
    await expect(setProductImage(supplier, product, new Uint8Array([1, 2, 3]), storage)).rejects.toEqual(limited);
  });
});

describe("suspended buyer", () => {
  it("cannot submit an order, immediately after suspension, even with a stale request context", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const product = await createTestProduct(supplier, categoryId, { basePrice: "1" });
    await setCartQuantity(buyer, supplier.orgId, product, 1000);
    await getDb().update(organizations).set({ status: "suspended" }).where(eq(organizations.id, buyer.orgId));
    // `buyer` still says orgStatus "active": the database decides.
    await expect(submitOnce(supplier, buyer, product)).rejects.toEqual(new StateError("buyer_suspended"));
  });

  it("cannot submit an order before an admin verified the business", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer("pending_review");
    await connectBuyer(supplier, buyer);
    const product = await createTestProduct(supplier, categoryId, { basePrice: "1" });
    await setCartQuantity(buyer, supplier.orgId, product, 1000);
    await expect(submitOnce(supplier, buyer, product)).rejects.toEqual(new StateError("buyer_not_verified"));
  });
});
