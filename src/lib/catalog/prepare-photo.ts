"use client";

import type { SheetImage } from "@/lib/catalog/sheet-images";

const MAX_SIDE = 1600;

/**
 * Shrinks a picture taken from a spreadsheet before upload (the server accepts
 * at most 4 MB per photo). Transparent areas become white; the server then
 * re-encodes it like any other product photo.
 */
export async function preparePhotoFile(image: SheetImage): Promise<File> {
  const bitmap = await createImageBitmap(new Blob([image.bytes as BlobPart], { type: image.mime }));
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("encode failed");
  return new File([blob], "photo.jpg", { type: "image/jpeg" });
}
