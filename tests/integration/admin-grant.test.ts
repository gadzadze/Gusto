import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { auditLogs, profiles } from "@/server/db/schema";
import { grantPlatformAdmin } from "@/server/domain/admin/grant-admin";
import { createAuthUser } from "./helpers";

describe("grantPlatformAdmin", () => {
  it("reports an unknown email without creating anything", async () => {
    expect(await grantPlatformAdmin("nobody@test.gusto.ge", "test")).toEqual({ status: "no_such_user" });
  });

  it("grants admin by email (case-insensitive) and audits it once", async () => {
    const user = await createAuthUser(`Admin-${Date.now()}@Test.Gusto.ge`);
    const first = await grantPlatformAdmin(user.email.toLowerCase(), "script:admin-grant");
    expect(first).toEqual({ status: "granted", userId: user.id });

    const [profile] = await getDb().select().from(profiles).where(eq(profiles.id, user.id));
    expect(profile.isPlatformAdmin).toBe(true);

    expect(await grantPlatformAdmin(user.email, "script:admin-grant")).toEqual({
      status: "already_admin",
      userId: user.id,
    });

    const audit = await getDb().select().from(auditLogs).where(eq(auditLogs.targetId, user.id));
    expect(audit).toEqual([
      expect.objectContaining({
        action: "profile.platform_admin_granted",
        actorUserId: null,
        actorLabel: "script:admin-grant",
      }),
    ]);
  });
});
