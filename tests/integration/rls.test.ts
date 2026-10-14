import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { onboardingSchema } from "@/lib/validation/onboarding";
import { getDb } from "@/server/db/client";
import { createOrganizationForUser } from "@/server/domain/onboarding/create-organization";
import { createAuthUser } from "./helpers";

// Supabase exposes the `public` schema through its Data API to the anon and
// authenticated roles. RLS with no policies must leave those roles with
// nothing. This test stays forever: every new table must enable RLS.
describe("row level security", () => {
  it("is enabled on every table in the public schema", async () => {
    const rows = await getDb().execute<{ table_name: string; rls: boolean }>(sql`
      select c.relname as table_name, c.relrowsecurity as rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname
    `);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => !r.rls).map((r) => r.table_name)).toEqual([]);
  });

  it("gives the anon and authenticated roles no rows and no writes", async () => {
    const user = await createAuthUser();
    await createOrganizationForUser(
      user.id,
      onboardingSchema.parse({
        kind: "buyer",
        businessName: "[TEST] RLS Café",
        businessType: "cafe",
        contactName: "Nino",
        phone: "555 12 34 56",
        city: "Tbilisi",
        addressLine: "Somewhere 1",
      }),
    );

    for (const role of ["anon", "authenticated"] as const) {
      const visible = await getDb().transaction(async (tx) => {
        await tx.execute(sql.raw(`set local role ${role}`));
        const [orgs] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from organizations`);
        const [profiles] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from profiles`);
        return orgs.n + profiles.n;
      });
      expect(visible).toBe(0);

      const insertError = await getDb()
        .transaction(async (tx) => {
          await tx.execute(sql.raw(`set local role ${role}`));
          await tx.execute(sql`
            insert into organizations (type, status, name, business_type, contact_name, phone, city)
            values ('buyer', 'active', 'x', 'cafe', 'x', '+995555123456', 'x')
          `);
        })
        .then(() => null, (error: unknown) => error);
      // Drizzle wraps the driver error; the Postgres message is on `cause`.
      expect(insertError).toMatchObject({ cause: { message: expect.stringMatching(/row-level security/) } });
    }
  });
});
