import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { customerSchema } from "@/lib/validation/customer";
import { isEmailAllowed, pinnedRoleFor, registrationFor } from "@/server/auth/allow-list";
import { getDb } from "@/server/db/client";
import { allowedEmails, auditLogs } from "@/server/db/schema";
import { allowEmail, listAllowedEmails, revokeEmail } from "@/server/domain/admin/access";
import type { AdminCtx } from "@/server/domain/context";
import { createCustomer } from "@/server/domain/customers/customers";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { notifyAdminsSupplierPending } from "@/server/notifications/admin-alerts";
import { createAdmin, createAuthUser, createSupplier, randomLegalId } from "./helpers";

let admin: AdminCtx;
beforeAll(async () => {
  admin = await createAdmin();
});

const fresh = () => `person-${randomUUID().slice(0, 8)}@test.gusto.ge`;
const input = (extra: Record<string, string> = {}) =>
  customerSchema.parse({ businessName: "[TEST] Buyer", phone: "555123456", priceListId: "", ...extra });

describe("allow-list", () => {
  it("an unknown address is not allowed; allowing it lets it in, case and spaces ignored", async () => {
    const email = fresh();
    expect(await isEmailAllowed(email)).toBe(false);
    expect(await allowEmail({ userId: admin.userId }, `  ${email.toUpperCase()} `, "Pilot supplier")).toMatchObject({ status: "allowed", email });
    expect(await isEmailAllowed(email)).toBe(true);
    expect(await isEmailAllowed(email.toUpperCase())).toBe(true);
    const [row] = await getDb().select().from(allowedEmails).where(eq(allowedEmails.email, email));
    expect(row).toMatchObject({ note: "Pilot supplier", createdByUserId: admin.userId, revokedAt: null });
  });

  it("allowing twice is a no-op; a bad address is refused", async () => {
    const email = fresh();
    await allowEmail({ userId: admin.userId }, email);
    expect(await allowEmail({ userId: admin.userId }, email)).toMatchObject({ status: "already_allowed" });
    const audits = await getDb().select().from(auditLogs).where(eq(auditLogs.targetId, email));
    expect(audits).toHaveLength(1);
    await expect(allowEmail({ userId: admin.userId }, "not-an-email")).rejects.toEqual(new StateError("invalid_email"));
  });

  it("revoking blocks the address; allowing again restores it; both are audited", async () => {
    const email = fresh();
    await allowEmail({ userId: admin.userId }, email);
    const [row] = await getDb().select().from(allowedEmails).where(eq(allowedEmails.email, email));
    await revokeEmail(admin, row.id);
    expect(await isEmailAllowed(email)).toBe(false);
    expect(await allowEmail({ userId: admin.userId }, email)).toMatchObject({ status: "restored" });
    expect(await isEmailAllowed(email)).toBe(true);
    const actions = (await getDb().select().from(auditLogs).where(eq(auditLogs.targetId, email))).map((a) => a.action);
    expect(actions.sort()).toEqual(["access.allow", "access.allow", "access.revoke"]);
  });

  it("an admin can't revoke their own address; unknown ids and non-admins get not found", async () => {
    const me = await createAuthUser();
    const meAdmin = { userId: me.id, isPlatformAdmin: true as const };
    await getDb().execute(sql`insert into profiles (id, is_platform_admin) values (${me.id}, true)`);
    await allowEmail({ userId: me.id }, me.email);
    const [row] = await getDb().select().from(allowedEmails).where(eq(allowedEmails.email, me.email.toLowerCase()));
    await expect(revokeEmail(meAdmin, row.id)).rejects.toEqual(new StateError("cannot_revoke_self"));
    await expect(revokeEmail(admin, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    await expect(revokeEmail(admin, "nope")).rejects.toBeInstanceOf(NotFoundError);
    const nobody = { userId: randomUUID(), isPlatformAdmin: false } as unknown as AdminCtx;
    await expect(revokeEmail(nobody, row.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listAllowedEmails(nobody)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lists active addresses before revoked ones", async () => {
    const a = fresh();
    const b = fresh();
    await allowEmail({ userId: admin.userId }, a);
    await allowEmail({ userId: admin.userId }, b);
    const [rowB] = await getDb().select().from(allowedEmails).where(eq(allowedEmails.email, b));
    await revokeEmail(admin, rowB.id);
    const list = await listAllowedEmails(admin);
    expect(list.findIndex((r) => r.email === a)).toBeLessThan(list.findIndex((r) => r.email === b));
  });

  it("the database refuses non-lowercase addresses and duplicates", async () => {
    await expect(getDb().insert(allowedEmails).values({ email: "Upper@test.gusto.ge" })).rejects.toThrow();
    const email = fresh();
    await getDb().insert(allowedEmails).values({ email });
    await expect(getDb().insert(allowedEmails).values({ email })).rejects.toThrow();
  });
});

describe("invitations do not let anyone in", () => {
  it("neither an invitation link nor an invitation addressed to an email opens the door", async () => {
    const supplier = await createSupplier();
    const invited = fresh();
    await createCustomer(supplier, input({ email: invited }));
    // An open invitation exists for this address, and it is still refused:
    // nobody gets a sign-in link or an account before the admin accepts them.
    expect(await isEmailAllowed(invited)).toBe(false);
    expect(await isEmailAllowed(invited.toUpperCase())).toBe(false);
    expect(await isEmailAllowed(fresh())).toBe(false);
  });

  it("the address can sign in once the admin accepts it, and not after a revocation", async () => {
    const supplier = await createSupplier();
    const invited = fresh();
    await createCustomer(supplier, input({ email: invited }));
    await allowEmail({ userId: admin.userId }, invited);
    expect(await isEmailAllowed(invited)).toBe(true);
    expect(await isEmailAllowed(invited.toUpperCase())).toBe(true);
    const [row] = await getDb().select().from(allowedEmails).where(eq(allowedEmails.email, invited));
    await revokeEmail(admin, row.id);
    expect(await isEmailAllowed(invited)).toBe(false);
  });
});

describe("migration backfill", () => {
  it("lets every pre-existing account stay (the SQL used by migration 0014)", async () => {
    const user = await createAuthUser(`Old.Account-${randomUUID().slice(0, 6)}@Test.Gusto.ge`);
    await getDb().execute(sql`
      INSERT INTO "allowed_emails" ("email", "note", "created_by_label")
      SELECT lower(btrim(u.email)), 'Existing account when sign-in became invite-only', 'migration'
      FROM auth.users u
      WHERE u.email IS NOT NULL AND btrim(u.email) <> ''
      ON CONFLICT ("email") DO NOTHING`);
    expect(await isEmailAllowed(user.email)).toBe(true);
  });
});

describe("registered role", () => {
  it("pins the role, reports it, and lets the admin change or clear it", async () => {
    const email = fresh();
    expect(await pinnedRoleFor(email)).toBeNull(); // no row
    expect(await allowEmail({ userId: admin.userId }, email, "Winiveria", "supplier")).toMatchObject({ status: "allowed" });
    expect(await pinnedRoleFor(email)).toBe("supplier");
    expect(await pinnedRoleFor(email.toUpperCase())).toBe("supplier");

    // Same role again: nothing to do. A different role: updated. null: either.
    expect(await allowEmail({ userId: admin.userId }, email, undefined, "supplier")).toMatchObject({ status: "already_allowed" });
    expect(await allowEmail({ userId: admin.userId }, email, undefined, "buyer")).toMatchObject({ status: "updated" });
    expect(await pinnedRoleFor(email)).toBe("buyer");
    expect(await allowEmail({ userId: admin.userId }, email, undefined, null)).toMatchObject({ status: "updated" });
    expect(await pinnedRoleFor(email)).toBeNull();

    // Leaving the role out never changes it.
    await allowEmail({ userId: admin.userId }, email, undefined, "supplier");
    expect(await allowEmail({ userId: admin.userId }, email)).toMatchObject({ status: "already_allowed" });
    expect(await pinnedRoleFor(email)).toBe("supplier");
  });

  it("a revoked address has no pinned role, and the role is audited", async () => {
    const email = fresh();
    await allowEmail({ userId: admin.userId }, email, undefined, "buyer");
    const [row] = await getDb().select().from(allowedEmails).where(eq(allowedEmails.email, email));
    expect(row.intendedRole).toBe("buyer");
    await revokeEmail(admin, row.id);
    expect(await pinnedRoleFor(email)).toBeNull();
    const audits = await getDb().select().from(auditLogs).where(eq(auditLogs.targetId, email));
    expect(audits.find((a) => a.action === "access.allow")?.data).toMatchObject({ role: "buyer" });
    expect(await pinnedRoleFor(null)).toBeNull();
  });
});

describe("admin alert for a supplier waiting for approval", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  it("emails every platform admin the business name and the review link (dev log without a key)", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await notifyAdminsSupplierPending("[TEST] Winiveria");
    expect(result.attempted).toBeGreaterThanOrEqual(1);
    const logged = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("[DEV EMAIL]");
    expect(logged).toContain("[TEST] Winiveria");
    expect(logged).toContain("/admin/suppliers?status=pending_review");
  });

  it("never throws when the email provider fails", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "202 <a@test.gusto.ge>";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifyAdminsSupplierPending("[TEST] X")).resolves.toMatchObject({ attempted: expect.any(Number) });
  });
});

describe("verified company on the allow-list", () => {
  it("records the vetted business and exposes it as the registration", async () => {
    const email = fresh();
    const legalId = randomLegalId();
    await allowEmail({ userId: admin.userId }, email, "called 12 Oct", "supplier", { businessName: " Winiveria ", legalId: ` ${legalId.slice(0, 3)}-${legalId.slice(3)} ` });
    expect(await registrationFor(email)).toEqual({ role: "supplier", businessName: "Winiveria", legalId });
  });

  it("an address without a company is not vetted", async () => {
    const email = fresh();
    await allowEmail({ userId: admin.userId }, email);
    expect(await registrationFor(email)).toEqual({ role: null, businessName: null, legalId: null });
    expect(await registrationFor("nobody@test.gusto.ge")).toBeNull();
  });

  it("rejects malformed IDs and an ID that already belongs to someone else", async () => {
    await expect(
      allowEmail({ userId: admin.userId }, fresh(), undefined, "buyer", { businessName: "X", legalId: "12345" }),
    ).rejects.toEqual(new StateError("invalid_legal_id"));
    const legalId = randomLegalId();
    await allowEmail({ userId: admin.userId }, fresh(), undefined, "buyer", { businessName: "A", legalId });
    await expect(
      allowEmail({ userId: admin.userId }, fresh(), undefined, "buyer", { businessName: "B", legalId }),
    ).rejects.toEqual(new StateError("legal_id_taken"));
    // The same company as a supplier is a different registration.
    await allowEmail({ userId: admin.userId }, fresh(), undefined, "supplier", { businessName: "A", legalId });
  });

  it("a revoked address has no registration", async () => {
    const email = fresh();
    await allowEmail({ userId: admin.userId }, email, undefined, "buyer", { businessName: "Z", legalId: randomLegalId() });
    const [row] = await getDb().select().from(allowedEmails).where(eq(allowedEmails.email, email));
    await revokeEmail(admin, row.id);
    expect(await registrationFor(email)).toBeNull();
  });
});

describe("a business that buys and resells is registered as both", () => {
  it("can be pinned to both, and the vetted legal ID then clashes with either kind", async () => {
    const email = fresh();
    const legalId = randomLegalId();
    expect(await allowEmail({ userId: admin.userId }, email, "Reseller", "both", { businessName: "[TEST] Reseller", legalId })).toMatchObject({ status: "allowed" });
    expect(await pinnedRoleFor(email)).toBe("both");
    expect(await registrationFor(email)).toEqual({ role: "both", businessName: "[TEST] Reseller", legalId });

    // The same ID cannot be vetted again for either kind, nor for another "both" address.
    for (const role of ["buyer", "supplier", "both"] as const) {
      await expect(allowEmail({ userId: admin.userId }, fresh(), undefined, role, { businessName: "[TEST] Other", legalId })).rejects.toEqual(new StateError("legal_id_taken"));
    }
    // Changing the pin to one kind frees the other kind for that ID.
    await allowEmail({ userId: admin.userId }, email, undefined, "buyer");
    expect(await allowEmail({ userId: admin.userId }, fresh(), undefined, "supplier", { businessName: "[TEST] Supplier arm", legalId })).toMatchObject({ status: "allowed" });
  });

  it("only buyer, supplier or both can be stored", async () => {
    const email = fresh();
    await allowEmail({ userId: admin.userId }, email);
    await expect(
      getDb().execute(sql`update allowed_emails set intended_role = 'everyone' where email = ${email}`),
    ).rejects.toThrow();
  });
});
