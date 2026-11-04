"use server";

import { refresh } from "next/cache";
import { parseQuantityInput } from "@/lib/quantity";
import { fieldErrorsFrom } from "@/lib/validation/form-errors";
import { productSchema } from "@/lib/validation/product";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireSupplier } from "@/server/auth/guards";
import {
  adjustStock,
  createProduct,
  removeProductImage,
  setProductActive,
  setProductImage,
  updateProduct,
  type CatalogWriteError,
} from "@/server/domain/catalog/products";
import { applyPhotoCandidate, findPhotos, listPhotoCandidates, searchPhotoCandidates, type PhotoCandidate, type PhotoFetchResult, type SearchOutcome } from "@/server/domain/catalog/photo-fetch";
import { applyWebImage, searchWebImages, type WebSearchOutcome } from "@/server/domain/catalog/web-image-search";
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

/** Ids of this supplier's products that have a barcode but no photo, for the bulk "find photos" button. */
export async function listPhotoCandidatesAction(): Promise<{ ok: true; productIds: string[] } | ProductError> {
  const ctx = await requireSupplier();
  return runAction<{ ok: true; productIds: string[] }, CatalogWriteError>("listPhotoCandidates", async () => ({
    ok: true,
    productIds: await listPhotoCandidates(ctx),
  }));
}

/** Looks up photos by barcode for one small batch of products (the client sends batches). */
export async function findPhotosAction(
  productIds: string[],
): Promise<{ ok: true; result: PhotoFetchResult } | ActionError<CatalogWriteError | "rate_limited">> {
  const ctx = await requireSupplier();
  if (!Array.isArray(productIds) || productIds.length > 100 || productIds.some((id) => typeof id !== "string")) {
    return { ok: false, error: "invalid" };
  }
  return runAction<{ ok: true; result: PhotoFetchResult }, CatalogWriteError | "rate_limited">("findPhotos", async () => {
    const result = await findPhotos(ctx, productIds, supabaseImageStorage());
    refresh();
    return { ok: true, result };
  });
}

/** Suggestions (Open Food Facts products with photos) for one product, found by its name. */
export async function searchPhotoCandidatesAction(
  productId: string,
): Promise<{ ok: true; outcome: SearchOutcome } | ActionError<CatalogWriteError | "rate_limited">> {
  const ctx = await requireSupplier();
  if (typeof productId !== "string") return { ok: false, error: "invalid" };
  return runAction<{ ok: true; outcome: SearchOutcome }, CatalogWriteError | "rate_limited">("searchPhotoCandidates", async () => ({
    ok: true,
    outcome: await searchPhotoCandidates(ctx, productId),
  }));
}

/** The supplier picked one suggestion for a product. */
export async function applyPhotoCandidateAction(
  productId: string,
  barcode: string,
): Promise<{ ok: true; status: "attached" | "not_found" | "unavailable" } | ActionError<CatalogWriteError>> {
  const ctx = await requireSupplier();
  if (typeof productId !== "string" || typeof barcode !== "string") return { ok: false, error: "invalid" };
  return runAction<{ ok: true; status: "attached" | "not_found" | "unavailable" }, CatalogWriteError>("applyPhotoCandidate", async () => {
    const status = await applyPhotoCandidate(ctx, productId, barcode, supabaseImageStorage());
    if (status === "attached") refresh();
    return { ok: true, status };
  });
}

export type { PhotoCandidate };

/** Web photo suggestions for one product (only when the search is configured). */
export async function searchWebImagesAction(
  productId: string,
): Promise<{ ok: true; outcome: WebSearchOutcome } | ActionError<CatalogWriteError | "rate_limited">> {
  const ctx = await requireSupplier();
  if (typeof productId !== "string") return { ok: false, error: "invalid" };
  return runAction<{ ok: true; outcome: WebSearchOutcome }, CatalogWriteError | "rate_limited">("searchWebImages", async () => ({
    ok: true,
    outcome: await searchWebImages(ctx, productId),
  }));
}

export async function applyWebImageAction(
  productId: string,
  token: string,
): Promise<{ ok: true; status: "attached" | "failed" } | ActionError<CatalogWriteError | "rate_limited">> {
  const ctx = await requireSupplier();
  if (typeof productId !== "string" || typeof token !== "string" || token.length > 4000) return { ok: false, error: "invalid" };
  return runAction<{ ok: true; status: "attached" | "failed" }, CatalogWriteError | "rate_limited">("applyWebImage", async () => {
    const status = await applyWebImage(ctx, productId, token, supabaseImageStorage());
    if (status === "attached") refresh();
    return { ok: true, status };
  });
}
