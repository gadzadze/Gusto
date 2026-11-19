import { describe, expect, it } from "vitest";
import { planRecipients } from "@/lib/notifications/plan";
import { buildPushBody, isAllowedPushEndpoint, pushSubscriptionSchema, safePushUrl } from "@/lib/push";

const KEY = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";

describe("push endpoints", () => {
  it("accepts the push services' hosts over https only", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QGm")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
  });
  it("refuses everything else, so the server never posts to a host the browser chose", () => {
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://evil.example/fcm.googleapis.com")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://user:pw@fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://127.0.0.1/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
  });
});

describe("push subscriptions", () => {
  it("accepts what a browser sends and rejects what it should not", () => {
    const good = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: KEY, auth: "tBHItJI5svbpez7KI4CCXg" } };
    expect(pushSubscriptionSchema.safeParse(good).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ ...good, endpoint: "https://evil.example/x" }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ ...good, keys: { p256dh: "not base64!", auth: "tBHItJI5svbpez7KI4CCXg" } }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint: good.endpoint }).success).toBe(false);
  });
});

describe("push messages", () => {
  it("only ever points at a page of this site", () => {
    expect(safePushUrl("/o/1051")).toBe("/o/1051");
    expect(safePushUrl("https://evil.example")).toBe("/start");
    expect(safePushUrl("//evil.example")).toBe("/start");
    expect(safePushUrl("/\\evil.example")).toBe("/start");
    expect(safePushUrl(null)).toBe("/start");
  });
  it("keeps the message small", () => {
    const body = JSON.parse(buildPushBody({ title: "t".repeat(500), body: "b".repeat(2000), url: "/o/1" }));
    expect(body.title.length).toBe(120);
    expect(body.body.length).toBe(300);
    expect(buildPushBody({ title: "a", body: "b", url: "/o/1" }).length).toBeLessThan(4000);
  });
});

describe("push in the notification plan", () => {
  const order = { buyerOrgId: "b", supplierOrgId: "s" };
  const members = [
    { userId: "u1", orgId: "s" },
    { userId: "u2", orgId: "s" },
  ];
  it("adds push for the people who turned it on, and only for them", () => {
    const planned = planRecipients({ event: "order_submitted", order, actor: { userId: "x", orgId: "b" }, members, preferences: new Map(), pushUsers: new Set(["u2"]) });
    expect(planned.find((p) => p.userId === "u1")?.channels).toEqual(["in_app", "email"]);
    expect(planned.find((p) => p.userId === "u2")?.channels).toEqual(["in_app", "email", "push"]);
  });
  it("is unchanged when nobody has push", () => {
    const planned = planRecipients({ event: "order_submitted", order, actor: { userId: "x", orgId: "b" }, members, preferences: new Map() });
    expect(planned.every((p) => !p.channels.includes("push"))).toBe(true);
  });
  it("does not push to the person who caused the event", () => {
    const planned = planRecipients({ event: "order_confirmed", order, actor: { userId: "u1", orgId: "s" }, members: [{ userId: "u1", orgId: "b" }], preferences: new Map(), pushUsers: new Set(["u1"]) });
    expect(planned).toEqual([]);
  });
});
