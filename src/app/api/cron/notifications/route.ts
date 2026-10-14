import { timingSafeEqual } from "node:crypto";
import { processDeliveries } from "@/server/notifications/process";
import { pruneRateLimits } from "@/server/security/rate-limit";

// Drains due outbox rows. Called every minute by Supabase Cron (pg_net), which
// sends POST; GET is accepted so it can be tried by hand. Both need
// `Authorization: Bearer $CRON_SECRET`. No secret configured = nobody gets in.

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function drain(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const result = await processDeliveries();
  // Housekeeping rides along: expired rate-limit windows.
  const prunedRateLimits = await pruneRateLimits().catch(() => 0);
  return Response.json({ ...result, prunedRateLimits });
}

export const GET = drain;
export const POST = drain;
