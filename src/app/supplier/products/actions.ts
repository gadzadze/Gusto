"use server";

import { refresh } from "next/cache";
import { fieldErrorsFrom } from "@/lib/validation/form-errors";
import { productSchema } from "@/lib/validation/product";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireSupplier } from "@/server/auth/guards";
import {
  createProduct,
  removeProductImage,
  setProductActive,
  setProductImage,
  updateProduct,
  type CatalogWriteError,
} from "@/server/domain/catalog/products";
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
