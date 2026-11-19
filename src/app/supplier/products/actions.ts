"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { parseQuantityInput } from "@/lib/quantity";
import { fieldErrorsFrom } from "@/lib/validation/form-errors";
import { productSchema } from "@/lib/validation/product";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireSupplier } from "@/server/auth/guards";
import {
  adjustStock,
  bulkDeleteProducts,
  bulkSetActive,
  bulkSetCategory,
  MAX_BULK_PRODUCTS,
  createProduct,
  deleteProduct,
  removeProductImage,
  setProductActive,
  setProductImage,
  updateProduct,
  type CatalogWriteError,
} from "@/server/domain/catalog/products";
import { createSavedFilter, deleteSavedFilter, type SavedFilterError } from "@/server/domain/filters/saved-filters";
import { ImageError, MAX_IMAGE_BYTES, type ImageErrorCode } from "@/server/storage/images";
import { supabaseImageStorage } from "@/server/storage/image-storage";

type ProductError = ActionError<CatalogWriteError>;

export async function createProductAction(raw: unknown): Promise<{ ok: true; productId: string } | ProductError> {
  const ctx = await requireSupplier();
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrorsFrom(parsed.error) };
  return runAction<{ ok: true; productId: string }, CatalogWriteError>("createProduct", async () => {
    const productId = await createProduct(ctx, parsed.data);
    refresh();
    return { ok: true, productId };
  });
}

export async function updateProductAction(productId: string, raw: unknown): Promise<{ ok: true } | ProductError> {
  const ctx = await requireSupplier();
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrorsFrom(parsed.error) };
  return runAction<{ ok: true }, CatalogWriteError>("updateProduct", async () => {
    await updateProduct(ctx, productId, parsed.data);
    refresh();
    return { ok: true };
  });
}

/** "add": goods received, added to the count. "set": a recount, replaces it. */
export async function adjustStockAction(
  productId: string,
  mode: "add" | "set",
  quantity: string,
): Promise<{ ok: true } | ProductError> {
  const ctx = await requireSupplier();
  const qtyMilli = parseQuantityInput(typeof quantity === "string" ? quantity : "");
  if ((mode !== "add" && mode !== "set") || qtyMilli === null) return { ok: false, error: "invalid_stock" };
  return runAction<{ ok: true }, CatalogWriteError>("adjustStock", async () => {
    await adjustStock(ctx, productId, { mode, qtyMilli });
    refresh();
    return { ok: true };
  });
}

export async function setProductActiveAction(productId: string, active: boolean): Promise<{ ok: true } | ProductError> {
  const ctx = await requireSupplier();
  return runAction<{ ok: true }, CatalogWriteError>("setProductActive", async () => {
    await setProductActive(ctx, productId, active === true);
    refresh();
    return { ok: true };
  });
}

export type ImageUploadError = ImageErrorCode | "upload_failed" | CatalogWriteError;

export async function uploadProductImageAction(
  productId: string,
  formData: FormData,
): Promise<{ ok: true; imagePath: string } | ActionError<ImageUploadError>> {
  const ctx = await requireSupplier();
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "empty" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "too_large" };

  type Result = { ok: true; imagePath: string } | ActionError<ImageUploadError>;
  return runAction<Result, ImageUploadError>("uploadProductImage", async (): Promise<Result> => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const imagePath = await setProductImage(ctx, productId, bytes, supabaseImageStorage());
      refresh();
      return { ok: true, imagePath };
    } catch (error) {
      if (error instanceof ImageError) return { ok: false, error: error.code };
      if (error instanceof Error && error.message.startsWith("storage ")) {
        console.error("[catalog] image upload failed", { productId, message: error.message });
        return { ok: false, error: "upload_failed" };
      }
      throw error;
    }
  });
}

export async function removeProductImageAction(productId: string): Promise<{ ok: true } | ProductError> {
  const ctx = await requireSupplier();
  return runAction<{ ok: true }, CatalogWriteError>("removeProductImage", async () => {
    await removeProductImage(ctx, productId, supabaseImageStorage());
    refresh();
    return { ok: true };
  });
}

export async function deleteProductAction(productId: string): Promise<{ ok: true } | ProductError> {
  const ctx = await requireSupplier();
  return runAction<{ ok: true }, CatalogWriteError>("deleteProduct", async () => {
    await deleteProduct(ctx, productId, supabaseImageStorage());
    refresh();
    return { ok: true };
  });
}

const bulkInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("show"), ids: z.array(z.uuid()).min(1).max(MAX_BULK_PRODUCTS) }),
  z.object({ action: z.literal("hide"), ids: z.array(z.uuid()).min(1).max(MAX_BULK_PRODUCTS) }),
  z.object({ action: z.literal("delete"), ids: z.array(z.uuid()).min(1).max(MAX_BULK_PRODUCTS) }),
  z.object({ action: z.literal("category"), ids: z.array(z.uuid()).min(1).max(MAX_BULK_PRODUCTS), categoryId: z.uuid() }),
]);

/** One action for the selected rows of the product list; returns how many products it changed. */
export async function bulkProductsAction(raw: unknown): Promise<{ ok: true; count: number } | ProductError> {
  const ctx = await requireSupplier();
  const parsed = bulkInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const input = parsed.data;
  return runAction<{ ok: true; count: number }, CatalogWriteError>("bulkProducts", async () => {
    const count =
      input.action === "show" ? await bulkSetActive(ctx, input.ids, true)
      : input.action === "hide" ? await bulkSetActive(ctx, input.ids, false)
      : input.action === "category" ? await bulkSetCategory(ctx, input.ids, input.categoryId)
      : await bulkDeleteProducts(ctx, input.ids, supabaseImageStorage());
    refresh();
    return { ok: true, count };
  });
}

/** Save the list's current filters under a name (per user and company). */
export async function saveProductFilterAction(name: string, query: string): Promise<{ ok: true } | ActionError<SavedFilterError>> {
  const ctx = await requireSupplier();
  if (typeof name !== "string" || typeof query !== "string" || query.length > 600) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, SavedFilterError>("saveProductFilter", async () => {
    await createSavedFilter(ctx, "products", name, query);
    refresh();
    return { ok: true };
  });
}

export async function deleteSavedFilterAction(id: string): Promise<{ ok: true } | ActionError<SavedFilterError>> {
  const ctx = await requireSupplier();
  return runAction<{ ok: true }, SavedFilterError>("deleteSavedFilter", async () => {
    await deleteSavedFilter(ctx, String(id));
    refresh();
    return { ok: true };
  });
}
