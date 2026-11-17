"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireSupplier } from "@/server/auth/guards";
import { connectRs, disconnectRs, type RsgeError } from "@/server/domain/waybills/rsge";

type Err = ActionError<RsgeError | "invalid">;
const credentials = z.object({ su: z.string().min(1).max(100), sp: z.string().min(1).max(200) });

export async function connectRsAction(raw: unknown): Promise<{ ok: true } | Err> {
  const ctx = await requireSupplier();
  const parsed = credentials.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, RsgeError | "invalid">("connectRs", async () => {
    await connectRs(ctx, parsed.data.su, parsed.data.sp);
    refresh();
    return { ok: true };
  });
}

export async function disconnectRsAction(): Promise<{ ok: true } | Err> {
  const ctx = await requireSupplier();
  return runAction<{ ok: true }, RsgeError | "invalid">("disconnectRs", async () => {
    await disconnectRs(ctx);
    refresh();
    return { ok: true };
  });
}
