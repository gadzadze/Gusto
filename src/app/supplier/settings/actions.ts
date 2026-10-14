"use server";

import { refresh } from "next/cache";
import { fieldErrorsFrom } from "@/lib/validation/form-errors";
import { supplierSettingsSchema } from "@/lib/validation/supplier-settings";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireSupplier } from "@/server/auth/guards";
import type { CatalogWriteError } from "@/server/domain/catalog/products";
import { updateSupplierSettings } from "@/server/domain/catalog/supplier-settings";

export async function updateSupplierSettingsAction(raw: unknown): Promise<{ ok: true } | ActionError<CatalogWriteError>> {
  const ctx = await requireSupplier();
  const parsed = supplierSettingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrorsFrom(parsed.error) };
  return runAction<{ ok: true }, CatalogWriteError>("updateSupplierSettings", async () => {
    await updateSupplierSettings(ctx, parsed.data);
    refresh();
    return { ok: true };
  });
}
