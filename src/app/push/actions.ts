"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { StateError } from "@/server/domain/errors";
import { pushSubscriptionSchema } from "@/lib/push";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireUser } from "@/server/auth/guards";
import { deletePushSubscription, hasPushSubscription, savePushSubscription, type PushSubscriptionError } from "@/server/domain/push/subscriptions";
import { renderTestPush } from "@/lib/notifications/templates";
import { listPushTargets } from "@/server/domain/push/subscriptions";
import { pushConfigured, webPushTransport } from "@/server/notifications/push";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";

// Turning Web Push on or off for the browser that calls. The subscription itself comes from the browser, so it is
// validated (known push service hosts only) before anything is stored or ever posted to.

export async function savePushSubscriptionAction(raw: unknown): Promise<{ ok: true } | ActionError<PushSubscriptionError | "not_configured">> {
  const user = await requireUser();
  const parsed = pushSubscriptionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (!pushConfigured()) return { ok: false, error: "not_configured" };
  return runAction<{ ok: true }, PushSubscriptionError>("savePushSubscription", async () => {
    await consumeRateLimit(RATE_LIMITS.pushSubscribe, user.userId);
    await savePushSubscription(user.userId, parsed.data, (await headers()).get("user-agent"));
    return { ok: true };
  });
}

export async function deletePushSubscriptionAction(endpoint: unknown): Promise<{ ok: true } | ActionError<never>> {
  const user = await requireUser();
  const parsed = z.string().max(2048).safeParse(endpoint);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, never>("deletePushSubscription", async () => {
    await consumeRateLimit(RATE_LIMITS.pushSubscribe, user.userId);
    await deletePushSubscription(user.userId, parsed.data);
    return { ok: true };
  });
}

/** Is this browser's subscription already stored for the signed-in person? (The page shows "on" only when so.) */
export async function pushSubscriptionStatusAction(endpoint: unknown): Promise<boolean> {
  const user = await requireUser();
  const parsed = z.string().max(2048).safeParse(endpoint);
  if (!parsed.success) return false;
  return hasPushSubscription(user.userId, parsed.data);
}

/** "Send a test": one message to every browser this person turned notifications on for. */
export async function sendTestPushAction(): Promise<{ ok: true; sent: number } | ActionError<"not_configured" | "no_subscription" | "failed">> {
  const user = await requireUser();
  if (!pushConfigured()) return { ok: false, error: "not_configured" };
  return runAction<{ ok: true; sent: number }, "no_subscription" | "failed">("sendTestPush", async () => {
    await consumeRateLimit(RATE_LIMITS.pushSubscribe, user.userId);
    const targets = await listPushTargets(user.userId);
    if (targets.length === 0) throw new StateError<"no_subscription">("no_subscription");
    const message = renderTestPush();
    let sent = 0;
    for (const target of targets) {
      if ((await webPushTransport(target, { ...message, url: "/start" })) === "sent") sent += 1;
    }
    if (sent === 0) throw new StateError<"failed">("failed");
    return { ok: true, sent };
  });
}
