import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

// Product images are re-encoded on the server before storage: the real
// format is read from the bytes (not the name or MIME type the browser
// claims), only JPEG/PNG/WebP are accepted, and the output is fresh WebP,
// which also drops EXIF/GPS metadata and anything appended to the file.

/**
 * 4 MB. Uploads go through a Server Action, and Vercel rejects function
 * request bodies above 4.5 MB, so the limit stays below that.
 */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000; // decompression-bomb guard
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp"]);

/** Sizes written for every image; the client loader picks one per width. */
export const IMAGE_WIDTHS = [400, 1200] as const;

export type ImageErrorCode = "empty" | "too_large" | "unsupported";

export class ImageError extends Error {
  constructor(public readonly code: ImageErrorCode) {
    super(code);
    this.name = "ImageError";
  }
}

export type ProcessedImage = { width: (typeof IMAGE_WIDTHS)[number]; body: Buffer }[];

export async function processProductImage(input: Uint8Array): Promise<ProcessedImage> {
  if (input.byteLength === 0) throw new ImageError("empty");
  if (input.byteLength > MAX_IMAGE_BYTES) throw new ImageError("too_large");

  let format: string | undefined;
  try {
    format = (await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()).format;
  } catch {
    throw new ImageError("unsupported");
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) throw new ImageError("unsupported");

  try {
    // rotate() applies the EXIF orientation before metadata is dropped.
    const base = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).rotate();
    return await Promise.all(
      IMAGE_WIDTHS.map(async (width) => ({
        width,
        body: await base
          .clone()
          .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
          .webp({ quality: width > 400 ? 82 : 78 })
          .toBuffer(),
      })),
    );
  } catch {
    throw new ImageError("unsupported");
  }
}

/** Storage path prefix for a new image; files are `${prefix}-w${width}.webp`. */
export function newImagePathPrefix(supplierOrgId: string, productId: string): string {
  return `${supplierOrgId}/${productId}/${randomUUID()}`;
}

export function imageFilePaths(prefix: string): string[] {
  return IMAGE_WIDTHS.map((w) => `${prefix}-w${w}.webp`);
}
