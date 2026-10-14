import type { OrgStatus, OrgType } from "@/server/db/schema";
import { NotFoundError } from "./errors";

// The slice of a guard's context that domain functions need. Guards in
// server/auth/guards.ts produce supersets of these; tests build them directly.

export type OrgCtx = { userId: string; orgId: string; orgType: OrgType; orgStatus: OrgStatus };
export type SupplierCtx = OrgCtx & { orgType: "supplier" };
export type AdminCtx = { userId: string; isPlatformAdmin: boolean };

/**
 * Defense in depth: domain functions re-check the role the guard already
 * checked, so a wrong call site fails closed ("not found") instead of
 * touching another role's data.
 */
export function assertSupplier(ctx: OrgCtx): asserts ctx is SupplierCtx {
  if (ctx.orgType !== "supplier") throw new NotFoundError();
}

export function assertAdmin(ctx: AdminCtx): void {
  if (ctx.isPlatformAdmin !== true) throw new NotFoundError();
}
