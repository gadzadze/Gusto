import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { auditLogs, organizations } from "@/server/db/schema";
import {
  countSuppliersByStatus,
  getSupplierForAdmin,
  listSuppliersForAdmin,
  reviewSupplier,
} from "@/server/domain/admin/suppliers";
import {
  createCategory,
  listActiveCategories,
  listAllCategories,
  moveCategory,
  renameCategory,
  setCategoryArchived,
} from "@/server/domain/catalog/categories";
import type { AdminCtx } from "@/server/domain/context";
import { ConflictError, NotFoundError, StateError } from "@/server/domain/errors";
import { createAdmin, createBuyer, createSupplier } from "./helpers";

let admin: AdminCtx;
beforeAll(async () => {
  admin = await createAdmin();
});

async function statusOf(orgId: string) {
  const [row] = await getDb().select({ status: organizations.status }).from(organizations).where(eq(organizations.id, orgId));
  return row.status;
}

async function auditFor(targetId: string) {
  return getDb()
    .select({ action: auditLogs.action, actorUserId: auditLogs.actorUserId, data: auditLogs.data })
    .from(auditLogs)
    .where(and(eq(auditLogs.targetType, "organization"), eq(auditLogs.targetId, targetId)));
}

describe("supplier review", () => {
  it("approves a pending supplier and audits it", async () => {
    const supplier = await createSupplier("pending_review");
    await reviewSupplier(admin, supplier.orgId, "approve");
    expect(await statusOf(supplier.orgId)).toBe("active");
    expect(await auditFor(supplier.orgId)).toEqual(
      expect.arrayContaining([
        {
          action: "supplier.approve",
          actorUserId: admin.userId,
          data: { before: "pending_review", after: "active", reason: null },
        },
      ]),
    );
  });

  it("suspends and reactivates only with a reason", async () => {
    const supplier = await createSupplier("active");
    await expect(reviewSupplier(admin, supplier.orgId, "suspend")).rejects.toEqual(new StateError("reason_required"));
    await expect(reviewSupplier(admin, supplier.orgId, "suspend", "  ")).rejects.toEqual(new StateError("reason_required"));
    expect(await statusOf(supplier.orgId)).toBe("active");

    await reviewSupplier(admin, supplier.orgId, "suspend", "Customer complaints");
    expect(await statusOf(supplier.orgId)).toBe("suspended");
    await reviewSupplier(admin, supplier.orgId, "reactivate", "Resolved");
    expect(await statusOf(supplier.orgId)).toBe("active");

    const actions = (await auditFor(supplier.orgId)).map((a) => [a.action, a.data?.reason]);
    expect(actions).toEqual(
      expect.arrayContaining([
        ["supplier.suspend", "Customer complaints"],
        ["supplier.reactivate", "Resolved"],
      ]),
    );
  });

  it("rejects actions that don't fit the current status (stale clicks)", async () => {
    const supplier = await createSupplier("active");
    await expect(reviewSupplier(admin, supplier.orgId, "approve")).rejects.toEqual(new StateError("stale_status"));
    await expect(reviewSupplier(admin, supplier.orgId, "reactivate", "why")).rejects.toEqual(
      new StateError("stale_status"),
    );
  });

  it("only one of two simultaneous approvals wins", async () => {
    const supplier = await createSupplier("pending_review");
    const results = await Promise.allSettled([
      reviewSupplier(admin, supplier.orgId, "approve"),
      reviewSupplier(admin, supplier.orgId, "approve"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await auditFor(supplier.orgId)).filter((a) => a.action === "supplier.approve")).toHaveLength(1);
  });

  it("treats buyers and unknown IDs as not found", async () => {
    const buyer = await createBuyer();
    await expect(reviewSupplier(admin, buyer.orgId, "approve")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getSupplierForAdmin(admin, buyer.orgId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      reviewSupplier(admin, "00000000-0000-4000-8000-000000000000", "approve"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses non-admins", async () => {
    const supplier = await createSupplier("pending_review");
    const notAdmin: AdminCtx = { userId: supplier.userId, isPlatformAdmin: false };
    await expect(reviewSupplier(notAdmin, supplier.orgId, "approve")).rejects.toBeInstanceOf(NotFoundError);
    await expect(listSuppliersForAdmin(notAdmin)).rejects.toBeInstanceOf(NotFoundError);
    expect(await statusOf(supplier.orgId)).toBe("pending_review");
  });

  it("lists suppliers by status with counts", async () => {
    const pending = await createSupplier("pending_review");
    const listed = await listSuppliersForAdmin(admin, "pending_review");
    expect(listed.map((s) => s.id)).toContain(pending.orgId);
    expect(listed.every((s) => s.status === "pending_review")).toBe(true);
    expect((await countSuppliersByStatus(admin)).pending_review).toBeGreaterThanOrEqual(1);
  });
});

describe("categories", () => {
  it("creates, renames, reorders and archives categories with audit rows", async () => {
    const a = await createCategory(admin, "[TEST] Order A");
    const b = await createCategory(admin, "[TEST] Order B");
    await expect(createCategory(admin, "[test] order a")).rejects.toEqual(new ConflictError("name_taken"));

    await renameCategory(admin, a, "[TEST] Order A2");
    await expect(renameCategory(admin, b, "[TEST] Order A2")).rejects.toEqual(new ConflictError("name_taken"));

    const order = async () => (await listActiveCategories()).map((c) => c.id).filter((id) => id === a || id === b);
    expect(await order()).toEqual([a, b]);
    await moveCategory(admin, b, "up");
    expect(await order()).toEqual([b, a]);

    await setCategoryArchived(admin, a, true);
    expect((await listActiveCategories()).map((c) => c.id)).not.toContain(a);
    expect((await listAllCategories(admin)).find((c) => c.id === a)?.isArchived).toBe(true);

    const actions = await getDb()
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.targetType, "category"), eq(auditLogs.targetId, a)));
    expect(actions.map((x) => x.action).sort()).toEqual(
      ["category.archived", "category.created", "category.renamed"].sort(),
    );
  });

  it("refuses non-admins", async () => {
    const notAdmin: AdminCtx = { userId: admin.userId, isPlatformAdmin: false };
    await expect(createCategory(notAdmin, "[TEST] Nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});
