import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/server/db/client";
import {
  addresses,
  notificationDeliveries,
  notifications,
  orders,
  organizationMemberships,
  organizations,
  profiles,
} from "@/server/db/schema";
import type { AdminCtx, OrgCtx, SupplierCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";
import { getCart, setCartQuantity } from "@/server/domain/orders/cart";
import { submitOrder } from "@/server/domain/orders/submit";
import { cancelByBuyer, confirmOrder, markDelivered, rejectOrder } from "@/server/domain/orders/transitions";
import { emailChannel } from "@/server/notifications/channels/email";
import type { Channel } from "@/server/notifications/channels";
import { sendEmail } from "@/server/notifications/email";
import { recordOrderEvent } from "@/server/notifications/events";
import { processDeliveries } from "@/server/notifications/process";
import {
  countUnread,
  listNotifications,
  markAllRead,
  markRead,
  setPreferences,
} from "@/server/notifications/queries";
import { GET as cronGet, POST as cronPost } from "@/app/api/cron/notifications/route";
import { connectBuyer, createAdmin, createAuthUser, createBuyer, createSupplier, createTestCategory, createTestProduct } from "./helpers";

let admin: AdminCtx;
let categoryId: string;
beforeAll(async () => {
  admin = await createAdmin();
  categoryId = (await createTestCategory(admin)).id;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

/** A second member of an existing organization. */
async function addMember(orgId: string): Promise<OrgCtx> {
  const user = await createAuthUser();
  await getDb().insert(profiles).values({ id: user.id }).onConflictDoNothing();
  await getDb().insert(organizationMemberships).values({ organizationId: orgId, userId: user.id, role: "member" });
  const [org] = await getDb().select({ type: organizations.type }).from(organizations).where(eq(organizations.id, orgId));
  return { userId: user.id, orgId, orgType: org.type, orgStatus: "active" };
}

async function placeOrder(supplier: SupplierCtx, buyer: OrgCtx) {
  const product = await createTestProduct(supplier, categoryId, { name: "[TEST] Item", basePrice: "10" });
  await setCartQuantity(buyer, supplier.orgId, product, 2000);
  const cart = await getCart(buyer, supplier.orgId);
  const [address] = await getDb().select({ id: addresses.id }).from(addresses).where(eq(addresses.organizationId, buyer.orgId));
  const result = await submitOrder(buyer, supplier.orgId, {
    idempotencyKey: randomUUID(),
    expected: cart.lines.map((l) => ({ productId: l.productId, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor })),
    addressId: address.id,
  });
  if (result.status !== "created") throw new Error("order was not created");
  return result;
}

async function rowsFor(orderId: string) {
  const db = getDb();
  return {
    notes: await db.select().from(notifications).where(eq(notifications.orderId, orderId)),
    deliveries: await db
      .select({ d: notificationDeliveries })
      .from(notificationDeliveries)
      .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
      .where(eq(notifications.orderId, orderId))
      .then((rows) => rows.map((r) => r.d)),
  };
}

describe("order events", () => {
  it("a submit creates exactly the expected rows: every supplier member, nobody else", async () => {
    const supplier = await createSupplier();
    const colleague = await addMember(supplier.orgId);
    const buyer = await createBuyer();
    const buyerColleague = await addMember(buyer.orgId);
    await connectBuyer(supplier, buyer);

    const { orderId } = await placeOrder(supplier, buyer);
    const { notes, deliveries } = await rowsFor(orderId);

    expect(notes.map((n) => n.userId).sort()).toEqual([supplier.userId, colleague.userId].sort());
    expect(notes.every((n) => n.event === "order_submitted" && n.readAt === null)).toBe(true);
    expect(notes.every((n) => n.counterpartyName.startsWith("[TEST] Café"))).toBe(true);
    expect(deliveries.map((d) => d.recipientUserId).sort()).toEqual([supplier.userId, colleague.userId].sort());
    expect(deliveries.every((d) => d.status === "pending" && d.channel === "email" && d.attempts === 0)).toBe(true);
    expect(deliveries.map((d) => d.dedupeKey).sort()).toEqual(
      [supplier.userId, colleague.userId].map((u) => `order:${orderId}:status:pending:email:${u}`).sort(),
    );
    expect(deliveries[0].payload).toEqual({ event: "order_submitted", orderId });
    // The buyer's side hears nothing about their own order.
    expect(notes.map((n) => n.userId)).not.toContain(buyer.userId);
    expect(notes.map((n) => n.userId)).not.toContain(buyerColleague.userId);
  });

  it("a rolled-back transaction leaves no notification behind", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const { orderId } = await placeOrder(supplier, buyer);
    const before = await rowsFor(orderId);

    await expect(
      getDb().transaction(async (tx) => {
        await tx.delete(notificationDeliveries).where(inArray(notificationDeliveries.notificationId, before.notes.map((n) => n.id)));
        await tx.delete(notifications).where(eq(notifications.orderId, orderId));
        await recordOrderEvent(tx, { orderId, event: "order_submitted", actor: { userId: buyer.userId, orgId: buyer.orgId } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const after = await rowsFor(orderId);
    expect(after.notes.map((n) => n.id).sort()).toEqual(before.notes.map((n) => n.id).sort());
  });

  it("a failed submit creates no order and no notification", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const countBefore = (await getDb().select().from(notifications).where(eq(notifications.userId, supplier.userId))).length;
    await expect(
      submitOrder(buyer, supplier.orgId, { idempotencyKey: randomUUID(), expected: [], addressId: randomUUID() }),
    ).rejects.toBeDefined();
    const countAfter = (await getDb().select().from(notifications).where(eq(notifications.userId, supplier.userId))).length;
    expect(countAfter).toBe(countBefore);
  });

  it("replaying an event adds nothing (dedupe)", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const { orderId } = await placeOrder(supplier, buyer);
    const before = await rowsFor(orderId);
    await getDb().transaction((tx) =>
      recordOrderEvent(tx, { orderId, event: "order_submitted", actor: { userId: buyer.userId, orgId: buyer.orgId } }),
    );
    const after = await rowsFor(orderId);
    expect(after.notes).toHaveLength(before.notes.length);
    expect(after.deliveries).toHaveLength(before.deliveries.length);
  });

  it("status changes notify the other side, never the actor, never another organization", async () => {
    const supplier = await createSupplier();
    const supplierColleague = await addMember(supplier.orgId);
    const buyer = await createBuyer();
    const buyerColleague = await addMember(buyer.orgId);
    const stranger = await createBuyer();
    const otherSupplier = await createSupplier();
    await connectBuyer(supplier, buyer);

    const { orderId } = await placeOrder(supplier, buyer);
    await confirmOrder(supplier, orderId, []);
    await markDelivered(supplier, orderId);

    const { notes } = await rowsFor(orderId);
    const byEvent = (event: string) => notes.filter((n) => n.event === event).map((n) => n.userId).sort();
    expect(byEvent("order_confirmed")).toEqual([buyer.userId, buyerColleague.userId].sort());
    expect(byEvent("order_delivered")).toEqual([buyer.userId, buyerColleague.userId].sort());
    const everyone = notes.map((n) => n.userId);
    for (const outsider of [stranger.userId, otherSupplier.userId]) expect(everyone).not.toContain(outsider);
    expect(await countUnread(stranger.userId)).toBe(0);
    expect(await countUnread(otherSupplier.userId)).toBe(0);
    // The supplier who acted got nothing for confirm/deliver; only the original new-order notice.
    expect(notes.filter((n) => n.userId === supplier.userId).map((n) => n.event)).toEqual(["order_submitted"]);
    expect(notes.filter((n) => n.userId === supplierColleague.userId).map((n) => n.event)).toEqual(["order_submitted"]);
  });

  it("rejecting and buyer-cancelling notify the right side", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);

    const rejected = await placeOrder(supplier, buyer);
    await rejectOrder(supplier, rejected.orderId, "Out of stock");
    expect((await rowsFor(rejected.orderId)).notes.filter((n) => n.event === "order_rejected").map((n) => n.userId)).toEqual([buyer.userId]);

    const cancelled = await placeOrder(supplier, buyer);
    await cancelByBuyer(buyer, cancelled.orderId);
    expect((await rowsFor(cancelled.orderId)).notes.filter((n) => n.event === "order_cancelled").map((n) => n.userId)).toEqual([supplier.userId]);
  });

  it("email preferences switch email off per event group; in-app stays", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    await setPreferences(supplier.userId, { emailNewOrders: false, emailOrderUpdates: true });
    await setPreferences(buyer.userId, { emailNewOrders: true, emailOrderUpdates: false });

    const { orderId } = await placeOrder(supplier, buyer);
    await confirmOrder(supplier, orderId, []);
    const { notes, deliveries } = await rowsFor(orderId);

    expect(notes.map((n) => [n.userId, n.event]).sort()).toEqual(
      [[supplier.userId, "order_submitted"], [buyer.userId, "order_confirmed"]].sort(),
    );
    expect(deliveries).toEqual([]);
  });
});

describe("delivery", () => {
  function countingChannel(sent: string[], fail = false): Channel {
    return {
      name: "email",
      enqueue: emailChannel.enqueue,
      async send(delivery) {
        if (fail) throw new Error("provider down");
        sent.push(delivery.id);
        return { status: "sent" };
      },
    };
  }

  it("running the drain twice, even at once, sends each delivery once", async () => {
    const supplier = await createSupplier();
    await addMember(supplier.orgId);
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const { orderId } = await placeOrder(supplier, buyer);

    const sent: string[] = [];
    const channel = countingChannel(sent);
    const [a, b] = await Promise.all([
      processDeliveries({ orderId, channels: [channel] }),
      processDeliveries({ orderId, channels: [channel] }),
    ]);
    const c = await processDeliveries({ orderId, channels: [channel] });

    expect(a.claimed + b.claimed).toBe(2);
    expect(c.claimed).toBe(0);
    expect(sent).toHaveLength(2);
    expect(new Set(sent).size).toBe(2);
    const { deliveries } = await rowsFor(orderId);
    expect(deliveries.every((d) => d.status === "sent" && d.sentAt !== null && d.attempts === 1)).toBe(true);
  });

  it("a throwing channel schedules a retry and leaves the order untouched", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const { orderId } = await placeOrder(supplier, buyer);

    const result = await processDeliveries({ orderId, channels: [countingChannel([], true)] });
    expect(result).toMatchObject({ claimed: 1, sent: 0, retried: 1, failed: 0 });

    const [delivery] = (await rowsFor(orderId)).deliveries;
    expect(delivery).toMatchObject({ status: "pending", attempts: 1, lastError: "provider down" });
    const waitMs = delivery.nextAttemptAt.getTime() - Date.now();
    expect(waitMs).toBeGreaterThan(30_000);
    expect(waitMs).toBeLessThanOrEqual(61_000);

    const [order] = await getDb().select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
    expect(order.status).toBe("pending");
    // Not due yet: an immediate re-run does nothing.
    expect((await processDeliveries({ orderId, channels: [countingChannel([], true)] })).claimed).toBe(0);
  });

  it("backs off 1, 5, 15, 60 minutes and then marks the delivery failed", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const { orderId } = await placeOrder(supplier, buyer);
    const failing = countingChannel([], true);
    const minutes: number[] = [];

    for (let attempt = 1; attempt <= 5; attempt++) {
      await getDb()
        .update(notificationDeliveries)
        .set({ nextAttemptAt: new Date(Date.now() - 1000) })
        .where(inArray(notificationDeliveries.notificationId, (await rowsFor(orderId)).notes.map((n) => n.id)));
      const result = await processDeliveries({ orderId, channels: [failing] });
      expect(result.claimed).toBe(1);
      const [d] = (await rowsFor(orderId)).deliveries;
      if (d.status === "pending") minutes.push(Math.round((d.nextAttemptAt.getTime() - Date.now()) / 60_000));
    }
    expect(minutes).toEqual([1, 5, 15, 60]);
    const [final] = (await rowsFor(orderId)).deliveries;
    expect(final).toMatchObject({ status: "failed", attempts: 5, lastError: "provider down" });
  });

  it("without RESEND_API_KEY the real email channel marks the delivery skipped, not sent", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const { orderId } = await placeOrder(supplier, buyer);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await processDeliveries({ orderId });
    expect(result).toMatchObject({ claimed: 1, skipped: 1, sent: 0 });
    const [d] = (await rowsFor(orderId)).deliveries;
    expect(d.status).toBe("skipped");
    expect(d.sentAt).toBeNull();
    const logged = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("[DEV EMAIL]");
    expect(logged).toContain(`/o/${(await getDb().select({ n: orders.number }).from(orders).where(eq(orders.id, orderId)))[0].n}`);
    log.mockRestore();
  });

  it("with a key, Resend gets the persisted order's real values", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "Gusto <orders@test.gusto.ge>";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const { orderId, number } = await placeOrder(supplier, buyer);

    const result = await processDeliveries({ orderId });
    expect(result).toMatchObject({ claimed: 1, sent: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init.body));
    expect(body.from).toBe("Gusto <orders@test.gusto.ge>");
    expect(body.subject).toBe(`ახალი შეკვეთა GST-${number}`);
    expect(body.text).toContain(`${process.env.NEXT_PUBLIC_APP_URL}/o/${number}`);
    expect(body.text).toContain("20,00");
    expect(body.html).toContain(`/o/${number}`);
    expect(body.to).toHaveLength(1);
  });

  it("a provider error is thrown by sendEmail so callers can retry", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "Gusto <orders@test.gusto.ge>";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name: "validation_error" }), { status: 422 })));
    await expect(sendEmail({ to: "x@test.gusto.ge", subject: "s", text: "t" })).rejects.toThrow("Resend responded 422 (validation_error)");
  });
});

describe("in-app notifications", () => {
  it("lists, counts and marks read only the user's own", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const first = await placeOrder(supplier, buyer);
    const second = await placeOrder(supplier, buyer);

    expect(await countUnread(supplier.userId)).toBe(2);
    const list = await listNotifications(supplier.userId);
    expect(list.items.map((n) => n.orderNumber)).toEqual([second.number, first.number]);

    // Someone else's notification is a 404, and stays unread.
    await expect(markRead(buyer.userId, list.items[0].id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(markRead(supplier.userId, "not-an-id")).rejects.toBeInstanceOf(NotFoundError);
    expect(await countUnread(supplier.userId)).toBe(2);

    expect(await markRead(supplier.userId, list.items[0].id)).toBe(second.number);
    expect(await countUnread(supplier.userId)).toBe(1);
    await markAllRead(supplier.userId);
    expect(await countUnread(supplier.userId)).toBe(0);
    expect(await countUnread(buyer.userId)).toBe(0);
  });
});

describe("cron route", () => {
  const url = "http://localhost/api/cron/notifications";

  it("rejects requests without the secret, with a wrong one, or when none is configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await cronPost(new Request(url, { method: "POST", headers: { authorization: "Bearer anything" } }))).status).toBe(401);

    process.env.CRON_SECRET = "right-secret";
    expect((await cronPost(new Request(url, { method: "POST" }))).status).toBe(401);
    expect((await cronPost(new Request(url, { method: "POST", headers: { authorization: "Bearer wrong-secret" } }))).status).toBe(401);
    expect((await cronGet(new Request(url, { headers: { authorization: "right-secret" } }))).status).toBe(401);
  });

  it("drains with the right secret", async () => {
    process.env.CRON_SECRET = "right-secret";
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const { orderId } = await placeOrder(supplier, buyer);
    vi.spyOn(console, "info").mockImplementation(() => {});

    const response = await cronPost(new Request(url, { method: "POST", headers: { authorization: "Bearer right-secret" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ claimed: expect.any(Number), sent: expect.any(Number) });
    const [d] = (await rowsFor(orderId)).deliveries;
    expect(d.status).toBe("skipped");
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });
});

