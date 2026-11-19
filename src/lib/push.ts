import { z } from "zod";

// Web Push helpers that need no server: what a subscription may look like, which hosts the server will post to, and
// the small JSON the service worker shows. The browser sends us its subscription, so every field is untrusted: the
// endpoint is a URL the server will request, which is why only the real push services' hosts are accepted.

/** Hosts of the push services the major browsers use. Anything else is refused (the server would otherwise post to it). */
const PUSH_HOST_SUFFIXES = [".googleapis.com", ".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com"] as const;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const base64url = z.string().min(8).max(256).regex(/^[A-Za-z0-9_-]+={0,2}$/);

/** The JSON a browser's PushSubscription turns into (`subscription.toJSON()`). */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isAllowedPushEndpoint, "endpoint"),
  keys: z.object({ p256dh: base64url, auth: base64url }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;

export type PushPayload = { title: string; body: string; url: string };

/** An internal path only ("/o/1051"): a pushed message may never send the person to another site. */
export function safePushUrl(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/start";
  return path.slice(0, 300);
}

/** The text sent to the service worker: kept well under the 4 KB a push message can carry. */
export function buildPushBody(payload: PushPayload): string {
  return JSON.stringify({
    title: payload.title.slice(0, 120),
    body: payload.body.slice(0, 300),
    url: safePushUrl(payload.url),
  });
}
