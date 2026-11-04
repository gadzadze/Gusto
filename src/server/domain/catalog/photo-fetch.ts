import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { products, sharedProductImages } from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";
import { assertCatalogWritable, isUuid } from "@/server/domain/catalog/products";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import type { ImageStorage } from "@/server/storage/image-storage";
import { ImageError, imageFilePaths, MAX_IMAGE_BYTES, processProductImage } from "@/server/storage/images";

// Automatic product photos. Source: Open Food Facts (open data; photos CC BY-SA, credit
// required). Only a barcode leaves our server, and only to that service. A photo is stored
// once per barcode in the shared library and reused by every supplier with that product.
// A supplier's own uploads are never added to the library or shown to anyone else.

const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product/";
const OFF_IMAGE_HOST = "images.openfoodfacts.org";
const USER_AGENT = "Gusto/1.0 (B2B ordering pilot, Georgia)";
const API_TIMEOUT_MS = 8000;
const IMAGE_TIMEOUT_MS = 10000;
export const PHOTO_BATCH_SIZE = 20;
const CONCURRENCY = 4;

export type PhotoFetchResult = { attached: number; notFound: number; failed: number };
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Barcodes are digits only, so building the URL from one cannot be abused. */
const BARCODE_RE = /^\d{8,14}$/;

async function readLimited(response: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > max) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength > max ? null : bytes;
}

/** The front photo of a barcode on Open Food Facts, or null (no such product / no photo / not usable). */
async function downloadFromOff(barcode: string, fetcher: Fetcher): Promise<Uint8Array | null> {
  const meta = await fetcher(`${OFF_PRODUCT_URL}${barcode}.json?fields=image_front_url`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (meta.status === 404) return null;
  if (!meta.ok) throw new Error(`off ${meta.status}`);
  const body = (await meta.json()) as { product?: { image_front_url?: unknown } };
  const raw = body.product?.image_front_url;
  if (typeof raw !== "string") return null;
  const url = new URL(raw);
  // Only ever fetch from their image host over https, whatever the response says.
  if (url.protocol !== "https:" || url.hostname !== OFF_IMAGE_HOST) return null;
  const image = await fetcher(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  if (!image.ok) return null;
  return readLimited(image, MAX_IMAGE_BYTES);
}

/** Stores a downloaded photo in the shared library (or returns the one a concurrent request stored). */
async function addToLibrary(barcode: string, bytes: Uint8Array, storage: ImageStorage): Promise<string | null> {
  const variants = await processProductImage(bytes);
  const prefix = `shared/${barcode}/${randomUUID()}`;
  const paths = imageFilePaths(prefix);
  await Promise.all(variants.map((v, i) => storage.put(paths[i], v.body, "image/webp")));
  const inserted = await getDb()
    .insert(sharedProductImages)
    .values({
      barcode,
      source: "open_food_facts",
      sourceUrl: `https://world.openfoodfacts.org/product/${barcode}`,
      attribution: "Open Food Facts, CC BY-SA 4.0",
      imagePath: prefix,
    })
    .onConflictDoNothing()
    .returning({ imagePath: sharedProductImages.imagePath });
  if (inserted.length > 0) return inserted[0].imagePath;
  // Someone else stored this barcode first: keep theirs, drop ours.
  await storage.remove(paths).catch(() => {});
  const [existing] = await getDb()
    .select({ imagePath: sharedProductImages.imagePath })
    .from(sharedProductImages)
    .where(eq(sharedProductImages.barcode, barcode));
  return existing?.imagePath ?? null;
}

/** Products of the supplier that have a barcode and no photo yet (most recent first), for the bulk button. */
export async function listPhotoCandidates(ctx: OrgCtx, limit = 200): Promise<string[]> {
  assertCatalogWritable(ctx);
  const rows = await getDb()
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.supplierOrgId, ctx.orgId), isNull(products.imagePath), isNotNull(products.barcode)))
    .limit(limit);
  return rows.map((r) => r.id);
}

/**
 * Finds photos for up to PHOTO_BATCH_SIZE of the supplier's own products that have a
 * barcode and no photo: first in the shared library, then on Open Food Facts. Products
 * that already have a photo are never touched.
 */
export async function findPhotos(
  ctx: OrgCtx,
  productIds: string[],
  storage: ImageStorage,
  fetcher: Fetcher = fetch,
): Promise<PhotoFetchResult> {
  assertCatalogWritable(ctx);
  const ids = [...new Set(productIds)].filter(isUuid).slice(0, PHOTO_BATCH_SIZE);
  const result: PhotoFetchResult = { attached: 0, notFound: 0, failed: 0 };
  if (ids.length === 0) return result;
  await consumeRateLimit(RATE_LIMITS.photoFetch, ctx.orgId);

  const db = getDb();
  const rows = await db
    .select({ id: products.id, barcode: products.barcode })
    .from(products)
    .where(
      and(
        eq(products.supplierOrgId, ctx.orgId),
        inArray(products.id, ids),
        isNull(products.imagePath),
        isNotNull(products.barcode),
      ),
    );
  const barcodes = [...new Set(rows.flatMap((r) => (r.barcode && BARCODE_RE.test(r.barcode) ? [r.barcode] : [])))];
  if (barcodes.length === 0) return result;

  const library = await db
    .select({ barcode: sharedProductImages.barcode, imagePath: sharedProductImages.imagePath })
    .from(sharedProductImages)
    .where(inArray(sharedProductImages.barcode, barcodes));
  const pathByBarcode = new Map(library.map((l) => [l.barcode, l.imagePath]));

  const missing = barcodes.filter((b) => !pathByBarcode.has(b));
  const failedBarcodes = new Set<string>();
  const notFoundBarcodes = new Set<string>();
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    await Promise.all(
      missing.slice(i, i + CONCURRENCY).map(async (barcode) => {
        try {
          const bytes = await downloadFromOff(barcode, fetcher);
          const path = bytes ? await addToLibrary(barcode, bytes, storage) : null;
          if (path) pathByBarcode.set(barcode, path);
          else notFoundBarcodes.add(barcode);
        } catch (error) {
          // An unreadable image is "no usable photo"; anything else (network, service down) is a failure to retry.
          if (error instanceof ImageError) notFoundBarcodes.add(barcode);
          else failedBarcodes.add(barcode);
        }
      }),
    );
  }

  for (const row of rows) {
    const barcode = row.barcode as string;
    const path = pathByBarcode.get(barcode);
    if (!path) {
      if (failedBarcodes.has(barcode)) result.failed += 1;
      else result.notFound += 1;
      continue;
    }
    const updated = await db
      .update(products)
      .set({ imagePath: path, imageSource: "shared" })
      .where(and(eq(products.id, row.id), eq(products.supplierOrgId, ctx.orgId), isNull(products.imagePath)))
      .returning({ id: products.id });
    result.attached += updated.length;
  }
  return result;
}
