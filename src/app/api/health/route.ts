import { connection } from "next/server";
import { checkHealth } from "@/server/health";

// Public on purpose: an uptime monitor calls it with no credentials. It returns
// three words and no counts, hosts or error text. 503 when the database is
// unreachable or the notification outbox has stalled, so any monitor that
// watches status codes alerts. The query also counts as database activity,
// which keeps a free-plan Supabase project from pausing for inactivity.
export async function GET(): Promise<Response> {
  await connection();
  const report = await checkHealth();
  return Response.json(
    { status: report.ok ? "ok" : "unhealthy", database: report.database, outbox: report.outbox },
    { status: report.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
