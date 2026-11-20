import { connection } from "next/server";
import { requireSupplier } from "@/server/auth/guards";
import { getPendingPulse } from "@/server/domain/orders/today";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { StateError } from "@/server/domain/errors";

// Polled by the open supplier dashboard and order inbox (components/orders/live-orders.tsx). The browser never
// talks to the database, so this is the live channel: authenticated like any supplier page, scoped to the
// acting company, and it returns only a count and a fingerprint.
export async function GET(): Promise<Response> {
  await connection();
  const ctx = await requireSupplier();
  try {
    await consumeRateLimit(RATE_LIMITS.supplierPulse, ctx.orgId);
  } catch (error) {
    if (error instanceof StateError) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Cache-Control": "no-store" } });
    throw error;
  }
  const pulse = await getPendingPulse(ctx);
  return Response.json(pulse, { headers: { "Cache-Control": "no-store" } });
}
