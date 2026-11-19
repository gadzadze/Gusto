import "server-only";
import { and, asc, count, eq } from "drizzle-orm";
import { MAX_PUSH_SUBSCRIPTIONS_PER_USER, type PushSubscriptionInput } from "@/lib/push";
import { getDb } from "@/server/db/client";
import { pushSubscriptions } from "@/server/db/schema";
import { StateError } from "@/server/domain/errors";

// A person's browsers that get Web Push. Scoped to the signed-in user: nobody can list, move or remove another
// person's subscription, and the endpoint (already checked against the push services' hosts) is the unique key.

export type PushSubscriptionError = "too_many";

/**
 * Remember this browser for the user. An endpoint belongs to one person at a time: signing in as someone else on the
 * same browser moves it to them (the previous person stops receiving pushes there). At most 10 browsers per person;
 * re-saving a known one never counts against that.
 */
export async function savePushSubscription(userId: string, input: PushSubscriptionInput, userAgent: string | null): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ userId: pushSubscriptions.userId })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, input.endpoint));
    if (!existing) {
      const [{ n }] = await tx.select({ n: count() }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
      if (n >= MAX_PUSH_SUBSCRIPTIONS_PER_USER) throw new StateError<PushSubscriptionError>("too_many");
    }
    await tx
      .insert(pushSubscriptions)
      .values({ userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null },
      });
  });
}

/** Stop pushing to this browser (only the person it belongs to can remove it). Returns whether one was removed. */
export async function deletePushSubscription(userId: string, endpoint: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .returning({ id: pushSubscriptions.id });
  return deleted.length > 0;
}

/** Whether this browser is already subscribed for this person. */
export async function hasPushSubscription(userId: string, endpoint: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .orderBy(asc(pushSubscriptions.createdAt))
    .limit(1);
  return Boolean(row);
}

/** The person's browsers, for sending them a message. */
export async function listPushTargets(userId: string): Promise<{ endpoint: string; p256dh: string; auth: string }[]> {
  return getDb()
    .select({ endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
}
