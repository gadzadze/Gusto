import "server-only";
import { sendNotification } from "web-push";
import { buildPushBody, type PushPayload } from "@/lib/push";

// Sending Web Push. Off unless the VAPID keys are set (`npm run push:keys` makes a pair): the public one is
// handed to the browser when someone turns notifications on, the private one signs every message. Like email, a
// missing configuration degrades loudly: deliveries are marked skipped, never sent.

const SEND_TIMEOUT_MS = 10_000;

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

/** What happened to one subscription: gone (the browser unsubscribed, remove it), failed (retry later) or delivered. */
export type PushResult = "sent" | "gone" | "failed";

export type PushTransport = (target: PushTarget, payload: PushPayload) => Promise<PushResult>;

export function pushPublicKey(): string | null {
  const key = process.env.VAPID_PUBLIC_KEY?.trim();
  return key && process.env.VAPID_PRIVATE_KEY?.trim() ? key : null;
}

export function pushConfigured(): boolean {
  return pushPublicKey() !== null;
}

function subject(): string {
  const configured = process.env.VAPID_SUBJECT?.trim();
  if (configured) return configured;
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://www.202.ge";
}

/** The real transport: web-push signs with the VAPID keys and encrypts for the subscription. Never logs the keys or endpoints. */
export const webPushTransport: PushTransport = async (target, payload) => {
  const publicKey = pushPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return "failed";
  try {
    await sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, buildPushBody(payload), {
      vapidDetails: { subject: subject(), publicKey, privateKey },
      TTL: 60 * 60 * 12, // an order notification older than half a day is stale
      urgency: "high",
      timeout: SEND_TIMEOUT_MS,
    });
    return "sent";
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "gone";
    console.error("[push] send failed", { status: status ?? "none" });
    return "failed";
  }
};
