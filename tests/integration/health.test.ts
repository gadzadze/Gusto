import { describe, expect, it } from "vitest";
import { checkHealth } from "@/server/health";

describe("checkHealth against the real schema", () => {
  it("runs its query (columns, enum value and interval syntax are valid)", async () => {
    // Other test files may leave deliveries behind, so only the database part
    // is asserted here; the overdue branch is covered in tests/unit/health.test.ts.
    const report = await checkHealth();
    expect(report.database).toBe("ok");
    expect(["ok", "stalled"]).toContain(report.outbox);
  });
});
