"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireSupplier } from "@/server/auth/guards";
import { activateWaybill, closeWaybill, discardDraft, readWaybillAtRs, saveWaybillDraft, type RsgeError } from "@/server/domain/waybills/rsge";

type Err = ActionError<RsgeError | "invalid">;
const id = z.uuid();

export async function saveWaybillDraftAction(orderId: string, transport: unknown): Promise<{ ok: true } | Err> {
  const ctx = await requireSupplier();
  if (!id.safeParse(orderId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, RsgeError | "invalid">("saveWaybillDraft", async () => {
    await saveWaybillDraft(ctx, orderId, transport);
    refresh();
    return { ok: true };
  });
}

export async function activateWaybillAction(orderId: string): Promise<{ ok: true; number: string } | Err> {
  const ctx = await requireSupplier();
  if (!id.safeParse(orderId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true; number: string }, RsgeError | "invalid">("activateWaybill", async () => {
    const number = await activateWaybill(ctx, orderId);
    refresh();
    return { ok: true, number };
  });
}

export async function closeWaybillAction(orderId: string): Promise<{ ok: true } | Err> {
  const ctx = await requireSupplier();
  if (!id.safeParse(orderId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, RsgeError | "invalid">("closeWaybill", async () => {
    await closeWaybill(ctx, orderId);
    refresh();
    return { ok: true };
  });
}

export async function discardWaybillDraftAction(orderId: string): Promise<{ ok: true } | Err> {
  const ctx = await requireSupplier();
  if (!id.safeParse(orderId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, RsgeError | "invalid">("discardWaybillDraft", async () => {
    await discardDraft(ctx, orderId);
    refresh();
    return { ok: true };
  });
}

export async function readWaybillAtRsAction(orderId: string): Promise<{ ok: true; xml: string } | Err> {
  const ctx = await requireSupplier();
  if (!id.safeParse(orderId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true; xml: string }, RsgeError | "invalid">("readWaybillAtRs", async () => ({ ok: true, xml: (await readWaybillAtRs(ctx, orderId)).slice(0, 20_000) }));
}
