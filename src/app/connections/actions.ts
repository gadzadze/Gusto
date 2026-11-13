"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireOrg } from "@/server/auth/guards";
import {
  decideConnectionRequest,
  findBusinessByCode,
  sendConnectionRequest,
  setFindable,
  withdrawConnectionRequest,
  type ConnectionError,
  type LookupResult,
} from "@/server/domain/connections/connections";

// Shared by the supplier and the buyer area: the guard gives the acting organization, and the domain
// functions decide everything from it. A business id or request id in the input is only looked up
// within what this organization may see.

type Err = ActionError<ConnectionError | "invalid">;
const id = z.uuid();

export async function findBusinessAction(code: string): Promise<{ ok: true; result: LookupResult } | Err> {
  const ctx = await requireOrg();
  if (typeof code !== "string" || code.length > 40) return { ok: false, error: "invalid" };
  return runAction<{ ok: true; result: LookupResult }, ConnectionError | "invalid">("findBusiness", async () => ({
    ok: true,
    result: await findBusinessByCode(ctx, code),
  }));
}

const sendSchema = z.object({
  targetOrgId: id,
  message: z.string().max(600).optional(),
  priceListId: z.uuid().nullable().optional(),
});

export async function sendConnectionRequestAction(raw: unknown): Promise<{ ok: true; status: "sent" | "connected" } | Err> {
  const ctx = await requireOrg();
  const parsed = sendSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true; status: "sent" | "connected" }, ConnectionError | "invalid">("sendConnectionRequest", async () => {
    const result = await sendConnectionRequest(ctx, parsed.data.targetOrgId, {
      message: parsed.data.message,
      priceListId: parsed.data.priceListId ?? null,
    });
    refresh();
    return { ok: true, status: result.status };
  });
}

const decideSchema = z.object({ requestId: id, approve: z.boolean(), priceListId: z.uuid().nullable().optional() });

export async function decideConnectionRequestAction(raw: unknown): Promise<{ ok: true } | Err> {
  const ctx = await requireOrg();
  const parsed = decideSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, ConnectionError | "invalid">("decideConnectionRequest", async () => {
    await decideConnectionRequest(ctx, parsed.data.requestId, parsed.data.approve, { priceListId: parsed.data.priceListId ?? null });
    refresh();
    return { ok: true };
  });
}

export async function withdrawConnectionRequestAction(requestId: string): Promise<{ ok: true } | Err> {
  const ctx = await requireOrg();
  if (!id.safeParse(requestId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, ConnectionError | "invalid">("withdrawConnectionRequest", async () => {
    await withdrawConnectionRequest(ctx, requestId);
    refresh();
    return { ok: true };
  });
}

export async function setFindableAction(findable: boolean): Promise<{ ok: true } | Err> {
  const ctx = await requireOrg();
  if (typeof findable !== "boolean") return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, ConnectionError | "invalid">("setFindable", async () => {
    await setFindable(ctx, findable);
    refresh();
    return { ok: true };
  });
}
