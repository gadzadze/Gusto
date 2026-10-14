"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrg } from "@/server/auth/guards";
import { runAction } from "@/server/actions/result";
import { markAllRead, markRead, setPreferences } from "@/server/notifications/queries";

// Shared by the buyer and supplier notification pages. Everything is scoped
// to the signed-in user; someone else's notification id is a 404.

export async function openNotificationAction(notificationId: string): Promise<void> {
  const ctx = await requireOrg();
  const result = await runAction<{ ok: true; number: number }, never>("openNotification", async () => ({
    ok: true,
    number: await markRead(ctx.userId, notificationId),
  }));
  if (!("number" in result)) return;
  redirect(`/o/${result.number}`);
}

export async function markAllReadAction(): Promise<void> {
  const ctx = await requireOrg();
  await markAllRead(ctx.userId);
  refresh();
}

const preferencesSchema = z.object({ emailNewOrders: z.boolean(), emailOrderUpdates: z.boolean() });

export async function savePreferencesAction(raw: unknown): Promise<{ ok: true } | { ok: false; error: "invalid" | "unknown" }> {
  const ctx = await requireOrg();
  const parsed = preferencesSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    await setPreferences(ctx.userId, parsed.data);
  } catch (error) {
    console.error("[action] savePreferences failed", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "unknown" };
  }
  refresh();
  return { ok: true };
}
