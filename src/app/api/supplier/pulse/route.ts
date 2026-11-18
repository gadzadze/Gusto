import { connection } from "next/server";
import { requireSupplier } from "@/server/auth/guards";
import { getPendingPulse } from "@/server/domain/orders/today";

// Polled by the open supplier dashboard and order inbox (components/orders/live-orders.tsx). The browser never
// talks to the database, so this is the live channel: authenticated like any supplier page, scoped to the
// acting company, and it returns only a count and a fingerprint.
export async function GET(): Promise<Response> {
  await connection();
  const ctx = await requireSupplier();
  const pulse = await getPendingPulse(ctx);
  return Response.json(pulse, { headers: { "Cache-Control": "no-store" } });
}
