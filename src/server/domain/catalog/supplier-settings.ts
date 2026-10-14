import "server-only";
import { eq } from "drizzle-orm";
import type { SupplierSettingsValues } from "@/lib/validation/supplier-settings";
import { getDb } from "@/server/db/client";
import { organizations, supplierSettings } from "@/server/db/schema";
import { assertSupplier, type OrgCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";
import { assertCatalogWritable } from "./products";

export type SupplierSettingsView = {
  contactName: string;
  phone: string;
  currency: string;
  minOrderMinor: number;
  pricesIncludeVat: boolean;
  deliveryArea: string | null;
  deliveryTerms: string | null;
  orderCutoffNote: string | null;
};

export async function getSupplierSettings(ctx: OrgCtx): Promise<SupplierSettingsView> {
  assertSupplier(ctx);
  const [row] = await getDb()
    .select({
      contactName: organizations.contactName,
      phone: organizations.phone,
      currency: organizations.currency,
      minOrderMinor: supplierSettings.minOrderMinor,
      pricesIncludeVat: supplierSettings.pricesIncludeVat,
      deliveryArea: supplierSettings.deliveryArea,
      deliveryTerms: supplierSettings.deliveryTerms,
      orderCutoffNote: supplierSettings.orderCutoffNote,
    })
    .from(organizations)
    .innerJoin(supplierSettings, eq(supplierSettings.organizationId, organizations.id))
    .where(eq(organizations.id, ctx.orgId));
  if (!row) throw new NotFoundError("supplier settings");
  return row;
}

export async function updateSupplierSettings(ctx: OrgCtx, values: SupplierSettingsValues): Promise<void> {
  assertCatalogWritable(ctx);
  await getDb().transaction(async (tx) => {
    await tx
      .update(organizations)
      .set({ contactName: values.contactName, phone: values.phone })
      .where(eq(organizations.id, ctx.orgId));
    await tx
      .update(supplierSettings)
      .set({
        minOrderMinor: values.minOrder,
        pricesIncludeVat: values.pricesIncludeVat,
        deliveryArea: values.deliveryArea,
        deliveryTerms: values.deliveryTerms,
        orderCutoffNote: values.orderCutoffNote,
      })
      .where(eq(supplierSettings.organizationId, ctx.orgId));
  });
}
