import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_PUSH_SUBSCRIPTIONS_PER_USER } from "@/lib/push";
import { getDb } from "@/server/db/client";
import { addresses, notificationDeliveries, notifications } from "@/server/db/schema";
import { StateError } from "@/server/domain/errors";
import { getCart, setCartQuantity } from "@/server/domain/orders/cart";
import { submitOrder } from "@/server/domain/orders/submit";
import { confirmOrder } from "@/server/domain/orders/transitions";
import { deletePushSubscription, hasPushSubscription, listPushTargets, savePushSubscription } from "@/server/domain/push/subscriptions";
import { createPushChannel } from "@/server/notifications/channels/push";
import type { PushResult } from "@/server/notifications/push";
import { connectBuyer, createAdmin, createBuyer, createSupplier, createTestCategory, createTestProduct } from "./helpers";

const KEYS = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
const sub = (id = randomUUID()) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: KEYS });

let categoryId: string;
const saved = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
beforeAll(async () => {
  categoryId = (await createTestCategory(await createAdmin())).id;
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
});
afterAll(() => {
  if (saved.pub === undefined) delete process.env.VAPID_PUBLIC_KEY;
  else process.env.VAPID_PUBLIC_KEY = saved.pub;
  if (saved.priv === undefined) delete process.env.VAPID_PRIVATE_KEY;
  else process.env.VAPID_PRIVATE_KEY = saved.priv;
});

async function placeOrder(buyer: Awaited<ReturnType<typeof createBuyer>>, supplier: Awaited<ReturnType<typeof createSupplier>>, productId: string) {
  await setCartQuantity(buyer, supplier.orgId, productId, 1000);
  const cart = await getCart(buyer, supplier.orgId);
  const [address] = await getDb().select({ id: addresses.id }).from(addresses).where(eq(addresses.organizationId, buyer.orgId));
  const result = await submitOrder(buyer, supplier.orgId, {
    idempotencyKey: randomUUID(),
    expected: cart.lines.map((l) => ({ productId: l.productId, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor })),
    addressId: address.id,
  });
  if (result.status === "changed") throw new Error("unexpected change");
  return result.orderId;
}

describe("push subscriptions", () => {
  it("stores a browser for a person, moves it to whoever signs in there next, and removes only your own", async () => {
    const a = await createSupplier();
    const b = await createSupplier();
    const s = sub();
    await savePushSubscription(a.userId, s, "Chrome");
    expect(await hasPushSubscription(a.userId, s.endpoint)).toBe(true);
    expect(await listPushTargets(a.userId)).toHaveLength(1);

    await savePushSubscription(b.userId, s, "Chrome"); // the same browser, another person
    expect(await hasPushSubscription(a.userId, s.endpoint)).toBe(false);
    expect(await hasPushSubscription(b.userId, s.endpoint)).toBe(true);

    expect(await deletePushSubscription(a.userId, s.endpoint)).toBe(false); // not theirs any more
    expect(await hasPushSubscription(b.userId, s.endpoint)).toBe(true);
    expect(await deletePushSubscription(b.userId, s.endpoint)).toBe(true);
  });

  it("keeps at most 10 browsers per person, and re-saving a known one never counts", async () => {
    const a = await createSupplier();
    const first = sub();
    await savePushSubscription(a.userId, first, null);
    for (let i = 1; i < MAX_PUSH_SUBSCRIPTIONS_PER_USER; i++) await savePushSubscription(a.userId, sub(), null);
    await expect(savePushSubscription(a.userId, sub(), null)).rejects.toEqual(new StateError("too_many"));
    await expect(savePushSubscription(a.userId, first, null)).resolves.toBeUndefined();
  });
});

describe("push delivery", () => {
  async function newOrderWithPush() {
    const supplier = await createSupplier();
    const other = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const product = await createTestProduct(supplier, categoryId, { name: "[TEST] Wine", basePrice: "10" });
    await savePushSubscription(supplier.userId, sub(), "Chrome");
    await savePushSubscription(other.userId, sub(), "Chrome");
    const orderId = await placeOrder(buyer, supplier, product);
    return { supplier, buyer, orderId };
  }

  it("queues a push for the supplier who turned it on, and none for people who did not", async () => {
    const { supplier, buyer, orderId } = await newOrderWithPush();
    const rows = await getDb().select().from(notificationDeliveries).where(eq(notificationDeliveries.channel, "push"));
    const forSupplier = rows.filter((r) => r.recipientUserId === supplier.userId && (r.payload as { orderId?: string }).orderId === orderId);
    expect(forSupplier).toHaveLength(1);
    expect(rows.some((r) => r.recipientUserId === buyer.userId)).toBe(false);
  });

  it("sends to every browser, forgets the ones that expired and retries when all fail", async () => {
    const { supplier, orderId } = await newOrderWithPush();
    const second = sub();
    await savePushSubscription(supplier.userId, second, "Firefox");
    const [delivery] = await getDb()
      .select()
      .from(notificationDeliveries)
      .where(and(eq(notificationDeliveries.recipientUserId, supplier.userId), eq(notificationDeliveries.channel, "push")));
    const claimed = { id: delivery.id, notificationId: delivery.notificationId, recipientUserId: supplier.userId, payload: delivery.payload as { event: string; orderId?: string }, attempts: 1 };
    const [notification] = await getDb().select().from(notifications).where(eq(notifications.id, delivery.notificationId));
    expect(notification.orderNumber).not.toBeNull();

    const seen: string[] = [];
    // One browser answers "gone", the other is delivered: sent, and the expired one is removed.
    const mixed = createPushChannel(async (target, payload) => {
      seen.push(payload.url);
      return (target.endpoint === second.endpoint ? "gone" : "sent") satisfies PushResult;
    });
    expect(await mixed.send!(claimed)).toEqual({ status: "sent" });
    expect(seen.every((u) => u === `/o/${notification.orderNumber}`)).toBe(true);
    expect(await hasPushSubscription(supplier.userId, second.endpoint)).toBe(false);
    expect(await listPushTargets(supplier.userId)).toHaveLength(1);

    // Every browser fails: ask for a retry.
    const failing = createPushChannel(async () => "failed");
    await expect(failing.send!(claimed)).rejects.toThrow();

    // Everything expired: skipped, nothing left to push to.
    const expired = createPushChannel(async () => "gone");
    expect(await expired.send!(claimed)).toMatchObject({ status: "skipped" });
    expect(await listPushTargets(supplier.userId)).toHaveLength(0);
    expect(await expired.send!(claimed)).toMatchObject({ status: "skipped", note: "recipient has no push subscription" });
    expect(orderId).toBeTruthy();
  });

  it("tells the buyer, in Georgian and with a link to the order, when the supplier confirms", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const product = await createTestProduct(supplier, categoryId, { name: "[TEST] Cheese", basePrice: "10" });
    await savePushSubscription(buyer.userId, sub(), "Safari");
    const orderId = await placeOrder(buyer, supplier, product);

    // Nothing for the buyer yet: only the supplier was told about the new order.
    const before = await getDb().select().from(notificationDeliveries).where(and(eq(notificationDeliveries.recipientUserId, buyer.userId), eq(notificationDeliveries.channel, "push")));
    expect(before).toHaveLength(0);

    await confirmOrder(supplier, orderId, []);

    const rows = await getDb().select().from(notificationDeliveries).where(and(eq(notificationDeliveries.recipientUserId, buyer.userId), eq(notificationDeliveries.channel, "push")));
    expect(rows).toHaveLength(1);
    const [delivery] = rows;
    expect(delivery.payload).toMatchObject({ event: "order_confirmed", orderId });
    const [notification] = await getDb().select().from(notifications).where(eq(notifications.id, delivery.notificationId));

    const seen: { title: string; body: string; url: string }[] = [];
    const channel = createPushChannel(async (_target, payload) => {
      seen.push(payload);
      return "sent";
    });
    const claimed = { id: delivery.id, notificationId: delivery.notificationId, recipientUserId: buyer.userId, payload: delivery.payload as { event: string; orderId?: string }, attempts: 1 };
    expect(await channel.send!(claimed)).toEqual({ status: "sent" });

    expect(seen).toHaveLength(1);
    expect(seen[0].title).toBe(`შეკვეთა GST-${notification.orderNumber} დადასტურდა`);
    expect(seen[0].body).toContain(notification.counterpartyName); // the supplier's name, as "from ..."
    expect(seen[0].body).toContain("10"); // the total
    expect(seen[0].url).toBe(`/o/${notification.orderNumber}`);

    // The supplier who confirmed is not told about their own action.
    const mine = await getDb().select().from(notificationDeliveries).where(and(eq(notificationDeliveries.recipientUserId, supplier.userId), eq(notificationDeliveries.channel, "push")));
    expect(mine.some((r) => (r.payload as { event: string }).event === "order_confirmed")).toBe(false);
  });

  it("is skipped, never sent, when push is not configured", async () => {
    const { supplier } = await newOrderWithPush();
    const [delivery] = await getDb()
      .select()
      .from(notificationDeliveries)
      .where(and(eq(notificationDeliveries.recipientUserId, supplier.userId), eq(notificationDeliveries.channel, "push")));
    const claimed = { id: delivery.id, notificationId: delivery.notificationId, recipientUserId: supplier.userId, payload: delivery.payload as { event: string; orderId?: string }, attempts: 1 };
    const channel = createPushChannel(async () => "sent");
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PUBLIC_KEY;
    try {
      expect(await channel.send!(claimed)).toEqual({ status: "skipped", note: "push is not configured" });
    } finally {
      process.env.VAPID_PUBLIC_KEY = publicKey;
    }
  });
});
