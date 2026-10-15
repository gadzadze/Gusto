import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { supplierRequestSchema } from "@/lib/validation/supplier-request";
import { registrationFor } from "@/server/auth/allow-list";
import { getDb } from "@/server/db/client";
import { auditLogs, supplierRequests } from "@/server/db/schema";
import {
  countSupplierRequests,
  createSupplierRequest,
  listSupplierRequests,
  reviewSupplierRequest,
} from "@/server/domain/admin/supplier-requests";
import type { AdminCtx } from "@/server/domain/context";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { createAdmin, createSupplier, randomLegalId } from "./helpers";

let admin: AdminCtx;
beforeAll(async () => {
  admin = await createAdmin();
});

const request = (extra: Record<string, string> = {}) =>
  supplierRequestSchema.parse({
    businessName: `[TEST] Supplier ${randomUUID().slice(0, 6)}`,
    legalId: randomLegalId(),
    contactName: "Giorgi",
    phone: "599 00 00 00",
    email: `req-${randomUUID().slice(0, 8)}@test.gusto.ge`,
    city: "თბილისი",
    ...extra,
  });

async function idOf(email: string) {
  const [row] = await getDb().select().from(supplierRequests).where(eq(supplierRequests.email, email));
  return row.id;
}

describe("public supplier requests", () => {
  it("stores a request as new and grants nothing", async () => {
    const values = request();
    expect(await createSupplierRequest(values)).toBe("created");
    const [row] = await getDb().select().from(supplierRequests).where(eq(supplierRequests.email, values.email));
    expect(row).toMatchObject({ status: "new", legalId: values.legalId, adminNote: null });
    expect(await registrationFor(values.email)).toBeNull();
  });

  it("treats an open request for the same address or the same business as a duplicate", async () => {
    const first = request();
    await createSupplierRequest(first);
    expect(await createSupplierRequest({ ...request(), email: first.email })).toBe("duplicate");
    expect(await createSupplierRequest({ ...request(), legalId: first.legalId })).toBe("duplicate");
    const rows = await getDb().select().from(supplierRequests).where(eq(supplierRequests.legalId, first.legalId));
    expect(rows).toHaveLength(1);
  });

  it("does not store a request for a business that is already a registered supplier", async () => {
    const supplier = await createSupplier();
    const { organizations } = await import("@/server/db/schema");
    const [org] = await getDb().select().from(organizations).where(eq(organizations.id, supplier.orgId));
    expect(await createSupplierRequest({ ...request(), legalId: org.legalId! })).toBe("duplicate");
  });
});

describe("reviewing supplier requests", () => {
  it("marks contacted, then approves: the address is registered as a vetted supplier", async () => {
    const values = request({ businessName: "[TEST] Approved Winery" });
    await createSupplierRequest(values);
    const id = await idOf(values.email);

    await reviewSupplierRequest(admin, id, "contacted", "Called, owner confirmed");
    await expect(reviewSupplierRequest(admin, id, "contacted")).rejects.toEqual(new StateError("stale_status"));

    await reviewSupplierRequest(admin, id, "approve");
    expect(await registrationFor(values.email)).toEqual({
      role: "supplier",
      businessName: "[TEST] Approved Winery",
      legalId: values.legalId,
    });
    const [row] = await getDb().select().from(supplierRequests).where(eq(supplierRequests.id, id));
    expect(row).toMatchObject({ status: "approved", reviewedByUserId: admin.userId });

    const log = await getDb().select().from(auditLogs).where(eq(auditLogs.targetId, id));
    expect(log.map((l) => l.action).sort()).toEqual(["request.approve", "request.contacted"]);
    // Finished: can't be approved again.
    await expect(reviewSupplierRequest(admin, id, "approve")).rejects.toEqual(new StateError("stale_status"));
  });

  it("rejects only with a reason, registers nothing, and lets the same business ask again", async () => {
    const values = request();
    await createSupplierRequest(values);
    const id = await idOf(values.email);
    await expect(reviewSupplierRequest(admin, id, "reject")).rejects.toEqual(new StateError("note_required"));
    await reviewSupplierRequest(admin, id, "reject", "Could not reach the owner");
    expect(await registrationFor(values.email)).toBeNull();
    expect(await createSupplierRequest(values)).toBe("created");
  });

  it("refuses to approve a business whose legal ID already belongs to another supplier", async () => {
    const values = request();
    await createSupplierRequest(values);
    const id = await idOf(values.email);
    // Someone else got this ID in the meantime.
    await createSupplier();
    const { allowEmail } = await import("@/server/domain/admin/access");
    await allowEmail({ userId: admin.userId }, `other-${randomUUID().slice(0, 6)}@test.gusto.ge`, undefined, "supplier", {
      businessName: "Other",
      legalId: values.legalId,
    });
    await expect(reviewSupplierRequest(admin, id, "approve")).rejects.toEqual(new StateError("legal_id_taken"));
    const [row] = await getDb().select().from(supplierRequests).where(eq(supplierRequests.id, id));
    expect(row.status).toBe("new");
  });

  it("lists open requests first and counts by status", async () => {
    const values = request();
    await createSupplierRequest(values);
    const list = await listSupplierRequests(admin);
    expect(list.find((r) => r.email === values.email)?.status).toBe("new");
    expect(list[0].status === "new" || list[0].status === "contacted").toBe(true);
    expect((await countSupplierRequests(admin)).new).toBeGreaterThanOrEqual(1);
  });

  it("answers an unknown id with not found", async () => {
    await expect(reviewSupplierRequest(admin, randomUUID(), "approve")).rejects.toBeInstanceOf(NotFoundError);
    await expect(reviewSupplierRequest(admin, "nope", "approve")).rejects.toBeInstanceOf(NotFoundError);
  });
});
