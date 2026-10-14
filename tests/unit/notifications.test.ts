import { describe, expect, it } from "vitest";
import { RETRY_DELAYS_MINUTES, MAX_ATTEMPTS, retryDelayMinutes } from "@/lib/notifications/backoff";
import { dedupeKey, eventGroup, planRecipients, recipientOrgId, type EmailPreferences } from "@/lib/notifications/plan";
import { formatMoney } from "@/lib/money";
import { counterpartyLine, notificationTitle, renderOrderEmail } from "@/lib/notifications/templates";

const BUYER_ORG = "b0000000-0000-4000-8000-000000000001";
const SUPPLIER_ORG = "50000000-0000-4000-8000-000000000002";
const order = { buyerOrgId: BUYER_ORG, supplierOrgId: SUPPLIER_ORG };
const members = [
  { userId: "buyer-owner", orgId: BUYER_ORG },
  { userId: "buyer-colleague", orgId: BUYER_ORG },
  { userId: "supplier-owner", orgId: SUPPLIER_ORG },
  { userId: "supplier-colleague", orgId: SUPPLIER_ORG },
  { userId: "someone-else", orgId: "ffffffff-0000-4000-8000-000000000003" },
];
const noPrefs = new Map<string, EmailPreferences>();

describe("planRecipients", () => {
  it("order_submitted goes to every supplier member and nobody else", () => {
    const out = planRecipients({
      event: "order_submitted",
      order,
      actor: { userId: "buyer-owner", orgId: BUYER_ORG },
      members,
      preferences: noPrefs,
    });
    expect(out.map((r) => r.userId).sort()).toEqual(["supplier-colleague", "supplier-owner"]);
    expect(out.every((r) => r.channels.join() === "in_app,email")).toBe(true);
  });

  it.each(["order_confirmed", "order_rejected", "order_delivered"] as const)("%s goes to buyer members", (event) => {
    const out = planRecipients({
      event,
      order,
      actor: { userId: "supplier-owner", orgId: SUPPLIER_ORG },
      members,
      preferences: noPrefs,
    });
    expect(out.map((r) => r.userId).sort()).toEqual(["buyer-colleague", "buyer-owner"]);
  });

  it("the actor is never notified of their own action", () => {
    const out = planRecipients({
      event: "order_cancelled",
      order,
      actor: { userId: "buyer-owner", orgId: BUYER_ORG },
      members,
      preferences: noPrefs,
    });
    // A buyer cancelling is news to the supplier side, not to the buyer's own member.
    expect(out.map((r) => r.userId)).not.toContain("buyer-owner");
    expect(out.map((r) => r.userId).sort()).toEqual(["supplier-colleague", "supplier-owner"]);
  });

  it("a supplier cancelling notifies the buyer side", () => {
    expect(recipientOrgId("order_cancelled", order, SUPPLIER_ORG)).toBe(BUYER_ORG);
  });

  it("email follows the preference for the event's group; in-app is always on", () => {
    const prefs = new Map<string, EmailPreferences>([
      ["supplier-owner", { emailNewOrders: false, emailOrderUpdates: true }],
      ["buyer-owner", { emailNewOrders: true, emailOrderUpdates: false }],
    ]);
    const submitted = planRecipients({
      event: "order_submitted",
      order,
      actor: { userId: "buyer-colleague", orgId: BUYER_ORG },
      members,
      preferences: prefs,
    });
    expect(submitted.find((r) => r.userId === "supplier-owner")?.channels).toEqual(["in_app"]);
    expect(submitted.find((r) => r.userId === "supplier-colleague")?.channels).toEqual(["in_app", "email"]);

    const confirmed = planRecipients({
      event: "order_confirmed",
      order,
      actor: { userId: "supplier-owner", orgId: SUPPLIER_ORG },
      members,
      preferences: prefs,
    });
    expect(confirmed.find((r) => r.userId === "buyer-owner")?.channels).toEqual(["in_app"]);
  });

  it("groups events", () => {
    expect(eventGroup("order_submitted")).toBe("new_orders");
    expect(eventGroup("order_delivered")).toBe("order_updates");
  });

  it("dedupe keys are per order, status, channel and user", () => {
    expect(dedupeKey("o1", "confirmed", "email", "u1")).toBe("order:o1:status:confirmed:email:u1");
    expect(dedupeKey("o1", "confirmed", "in_app", "u1")).not.toBe(dedupeKey("o1", "confirmed", "email", "u1"));
  });
});

// formatMoney uses a non-breaking space before the symbol; assert against its output, and its shape.
const FORMATTED_TOTAL = formatMoney(123_450, "GEL");

describe("email templates", () => {
  const data = {
    event: "order_submitted" as const,
    orderNumber: 1042,
    counterpartyName: "[TEST] რესტორანი <ბარი> & Co",
    counterpartyRole: "buyer" as const,
    itemCount: 7,
    totalMinor: 123_450,
    currency: "GEL",
    link: "https://gusto.example/o/1042",
  };

  it("uses the real order values, with the currency formatted", () => {
    const mail = renderOrderEmail(data);
    expect(mail.subject).toBe("ახალი შეკვეთა GST-1042");
    for (const part of ["GST-1042", "[TEST] რესტორანი <ბარი> & Co", "7", FORMATTED_TOTAL, "https://gusto.example/o/1042"]) {
      expect(mail.text).toContain(part);
    }
    expect(mail.text).toContain("მყიდველი:");
  });

  it("formats the total as lari with a decimal comma", () => {
    expect(FORMATTED_TOTAL).toMatch(/^1234,50\s₾$/);
  });

  it("escapes values in the HTML part and keeps the link", () => {
    const mail = renderOrderEmail(data);
    expect(mail.html).toContain("&lt;ბარი&gt; &amp; Co");
    expect(mail.html).not.toContain("<ბარი>");
    expect(mail.html).toContain('href="https://gusto.example/o/1042"');
    expect(mail.html).toContain(FORMATTED_TOTAL);
  });

  it("names the supplier when the recipient is the buyer", () => {
    const mail = renderOrderEmail({ ...data, event: "order_confirmed", counterpartyRole: "supplier", counterpartyName: "[TEST] მომწოდებელი" });
    expect(mail.subject).toBe("შეკვეთა GST-1042 დადასტურდა");
    expect(mail.text).toContain("მომწოდებელი: [TEST] მომწოდებელი");
  });

  it("has a title and counterparty line for the in-app list", () => {
    expect(notificationTitle("order_delivered", 1001)).toBe("შეკვეთა GST-1001 მიწოდებულია");
    expect(counterpartyLine("buyer", "X")).toBe("მყიდველი: X");
  });
});

describe("retry backoff", () => {
  it("waits 1, 5, 15 and 60 minutes, then gives up", () => {
    expect(RETRY_DELAYS_MINUTES).toEqual([1, 5, 15, 60]);
    expect([1, 2, 3, 4].map(retryDelayMinutes)).toEqual([1, 5, 15, 60]);
    expect(retryDelayMinutes(5)).toBeNull();
    expect(MAX_ATTEMPTS).toBe(5);
  });

  it("is null for nonsense attempt counts", () => {
    expect(retryDelayMinutes(0)).toBeNull();
    expect(retryDelayMinutes(-1)).toBeNull();
    expect(retryDelayMinutes(1.5)).toBeNull();
  });
});
