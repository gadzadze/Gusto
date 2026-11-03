import { describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { checkHealth } from "@/server/health";

// A stand-in for the one method the check uses. The real query runs against
// Postgres in tests/integration/health.test.ts.
function fakeDb(execute: () => Promise<unknown>): () => Db {
  return () => ({ execute }) as unknown as Db;
}

describe("checkHealth", () => {
  it("is ok when the database answers and nothing is overdue", async () => {
    const report = await checkHealth(fakeDb(async () => [{ stalled: 0 }]));
    expect(report).toEqual({ ok: true, database: "ok", outbox: "ok" });
  });

  it("is unhealthy when deliveries are overdue, because the cron has stopped", async () => {
    const report = await checkHealth(fakeDb(async () => [{ stalled: 3 }]));
    expect(report).toEqual({ ok: false, database: "ok", outbox: "stalled" });
  });

  it("is down when the query fails, without leaking the error", async () => {
    const report = await checkHealth(
      fakeDb(async () => {
        throw new Error("connect ECONNREFUSED db.secret-host.example:5432");
      }),
    );
    expect(report).toEqual({ ok: false, database: "down", outbox: "unknown" });
    expect(JSON.stringify(report)).not.toContain("secret-host");
  });

  it("is down when the database cannot even be configured", async () => {
    const report = await checkHealth(() => {
      throw new Error("DATABASE_URL is not set.");
    });
    expect(report.database).toBe("down");
    expect(report.ok).toBe(false);
  });

  it("is down when the query hangs", async () => {
    const report = await checkHealth(fakeDb(() => new Promise(() => {})));
    expect(report.database).toBe("down");
  }, 10_000);
});
