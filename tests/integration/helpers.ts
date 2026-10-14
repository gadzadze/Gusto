import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { onboardingSchema } from "@/lib/validation/onboarding";
import { productSchema, type ProductInput } from "@/lib/validation/product";
import { getDb } from "@/server/db/client";
import { organizations, type OrgStatus } from "@/server/db/schema";
import { grantPlatformAdmin } from "@/server/domain/admin/grant-admin";
import { createCategory } from "@/server/domain/catalog/categories";
import { createProduct } from "@/server/domain/catalog/products";
import type { AdminCtx, OrgCtx, SupplierCtx } from "@/server/domain/context";
import { createOrganizationForUser } from "@/server/domain/onboarding/create-organization";
import type { ImageStorage } from "@/server/storage/image-storage";

/** Inserts a user into the auth.users stand-in, as Supabase Auth would on sign-up. */
export async function createAuthUser(email = `user-${randomUUID()}@test.gusto.ge`): Promise<{ id: string; email: string }> {
  const rows = await getDb().execute<{ id: string }>(
    sql`insert into auth.users (email) values (${email}) returning id`,
  );
  return { id: rows[0].id, email };
}

export async function createSupplier(status: OrgStatus = "active"): Promise<SupplierCtx> {
  const user = await createAuthUser();
  const { orgId } = await createOrganizationForUser(
    user.id,
    onboardingSchema.parse({
      kind: "supplier",
      businessName: `[TEST] Supplier ${randomUUID().slice(0, 6)}`,
      contactName: "Giorgi",
      phone: "599 00 00 00",
      city: "Tbilisi",
      deliveryArea: "Tbilisi",
    }),
  );
  if (status !== "pending_review") {
    await getDb().update(organizations).set({ status }).where(eq(organizations.id, orgId));
  }
  return { userId: user.id, orgId, orgType: "supplier", orgStatus: status };
}

export async function createBuyer(): Promise<OrgCtx> {
  const user = await createAuthUser();
  const { orgId } = await createOrganizationForUser(
    user.id,
    onboardingSchema.parse({
      kind: "buyer",
      businessName: `[TEST] Café ${randomUUID().slice(0, 6)}`,
      businessType: "cafe",
      contactName: "Nino",
      phone: "555 12 34 56",
      city: "Tbilisi",
      addressLine: "Somewhere 1",
    }),
  );
  return { userId: user.id, orgId, orgType: "buyer", orgStatus: "active" };
}

export async function createAdmin(): Promise<AdminCtx> {
  const user = await createAuthUser();
  await grantPlatformAdmin(user.email, "test");
  return { userId: user.id, isPlatformAdmin: true };
}

export async function createTestCategory(admin: AdminCtx, name = `[TEST] Category ${randomUUID().slice(0, 8)}`) {
  return { id: await createCategory(admin, name), name };
}

export function productInput(categoryId: string, overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    name: "[TEST] Product",
    description: "",
    brand: "",
    sku: "",
    categoryId,
    unit: "piece",
    packDescription: "",
    basePrice: "10",
    vatRate: "18",
    minQty: "1",
    qtyStep: "1",
    ...overrides,
  };
}

export async function createTestProduct(ctx: OrgCtx, categoryId: string, overrides: Partial<ProductInput> = {}) {
  return createProduct(ctx, productSchema.parse(productInput(categoryId, overrides)));
}

/** In-memory ImageStorage for tests; Supabase Storage in the app. */
export function memoryStorage(): ImageStorage & { files: Map<string, Buffer>; removed: string[] } {
  const files = new Map<string, Buffer>();
  const removed: string[] = [];
  return {
    files,
    removed,
    async put(path, body) {
      if (files.has(path)) throw new Error("storage object exists");
      files.set(path, body);
    },
    async remove(paths) {
      for (const p of paths) {
        files.delete(p);
        removed.push(p);
      }
    },
  };
}

/** Invites `buyer` as a customer of `supplier` (optionally on a price list) and accepts. */
export async function connectBuyer(
  supplier: SupplierCtx,
  buyer: OrgCtx,
  priceListId: string | null = null,
): Promise<{ customerId: string }> {
  const { createCustomer } = await import("@/server/domain/customers/customers");
  const { acceptInvitationAsBuyer } = await import("@/server/domain/customers/invitations");
  const { customerSchema } = await import("@/lib/validation/customer");
  const { customerId, token } = await createCustomer(
    supplier,
    customerSchema.parse({ businessName: "[TEST] Customer", phone: "555123456", priceListId: priceListId ?? "" }),
  );
  await acceptInvitationAsBuyer(buyer, token);
  return { customerId };
}
