import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { products } from "@/server/db/schema";
import { assertCatalogWritable, isUuid } from "@/server/domain/catalog/products";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";
import { serviceRoleKey } from "@/server/env";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import type { ImageStorage } from "@/server/storage/image-storage";
import { ImageError, imageFilePaths, MAX_IMAGE_BYTES, newImagePathPrefix, processProductImage } from "@/server/storage/images";

// Web photo search (optional; hidden unless IMAGE_SEARCH_API_KEY and IMAGE_SEARCH_ENGINE_ID are set).
// Photos on the web belong to someone else, so the rules differ from Open Food Facts:
//   - the supplier picks the photo, nothing is applied automatically;
//   - the photo is stored as THAT supplier's own upload (private: never in the shared library,
//     never offered to another supplier) together with the page it came from;
//   - the browser never names a URL: it can only return a candidate this server produced
//     (signed), and downloads are limited to public internet hosts.

const SEARCH_URL = "https://www.googleapis.com/customsearch/v1";
const THUMB_HOST = /(^|\.)gstatic\.com$/;
const MAX_CANDIDATES = 6;
const MAX_THUMB_BYTES = 200 * 1024;
const MAX_REDIRECTS = 2;
const TIMEOUT_MS = 10000;
const USER_AGENT = "Gusto/1.0 (B2B ordering pilot, Georgia)";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type Resolver = (host: string) => Promise<string[]>;

export type WebCandidate = {
  /** Signed: the apply step accepts only values this server produced. */
  token: string;
  /** Small preview as a data URL, fetched here so the page needs no extra image hosts. */
  thumbnail: string;
  title: string;
  site: string;
};
export type WebSearchOutcome = { candidates: WebCandidate[]; unavailable: boolean };

export function webImageSearchEnabled(): boolean {
  return Boolean(process.env.IMAGE_SEARCH_API_KEY && process.env.IMAGE_SEARCH_ENGINE_ID);
}

// ---- signing ---------------------------------------------------------------------

type Payload = { imageUrl: string; pageUrl: string; orgId: string };
const sign = (data: string) => createHmac("sha256", `web-image:${serviceRoleKey()}`).update(data).digest("base64url");

export function signCandidate(payload: Payload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function readCandidate(token: string, orgId: string): Payload | null {
  const [data, mac] = token.split(".");
  if (!data || !mac) return null;
  const expected = sign(data);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as Payload;
    // A token is only good for the supplier it was issued to.
    return payload.orgId === orgId && typeof payload.imageUrl === "string" && typeof payload.pageUrl === "string" ? payload : null;
  } catch {
    return null;
  }
}

// ---- safe downloads --------------------------------------------------------------

/** True for loopback, private, link-local, carrier-NAT and other non-public addresses. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224
    );
  }
  if (version === 6) {
    const v = address.toLowerCase();
    if (v === "::" || v === "::1" || v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return mapped ? isPublicAddress(mapped[1]) : true;
  }
  return false;
}

const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

async function assertPublicHttps(raw: string, resolve: Resolver): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("blocked url");
  const addresses = isIP(url.hostname) ? [url.hostname] : await resolve(url.hostname);
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) throw new Error("blocked host");
  return url;
}

/** Downloads an image from a public https host: redirects re-checked, size and time limited. */
export async function downloadPublicImage(rawUrl: string, fetcher: Fetcher, resolve: Resolver, maxBytes = MAX_IMAGE_BYTES): Promise<Uint8Array> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicHttps(current, resolve);
    const response = await fetcher(url.toString(), {
      headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) throw new Error("bad redirect");
      current = new URL(next, url).toString();
      continue;
    }
    if (!response.ok) throw new Error(`status ${response.status}`);
    if (Number(response.headers.get("content-length") ?? 0) > maxBytes) throw new ImageError("too_large");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new ImageError("too_large");
    return bytes;
  }
  throw new Error("too many redirects");
}

// ---- search and apply ------------------------------------------------------------

type GoogleItem = { link?: unknown; title?: unknown; displayLink?: unknown; image?: { thumbnailLink?: unknown; contextLink?: unknown } };

export async function searchWebImages(
  ctx: OrgCtx,
  productId: string,
  fetcher: Fetcher = fetch,
  resolve: Resolver = defaultResolver,
): Promise<WebSearchOutcome> {
  assertCatalogWritable(ctx);
  if (!isUuid(productId)) throw new NotFoundError("product");
  const [product] = await getDb()
    .select({ name: products.name, brand: products.brand, imagePath: products.imagePath })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.supplierOrgId, ctx.orgId)));
  if (!product) throw new NotFoundError("product");
  if (product.imagePath || !webImageSearchEnabled()) return { candidates: [], unavailable: false };
  await consumeRateLimit(RATE_LIMITS.webImageSearch, ctx.orgId);

  const query = [product.brand, product.name].filter(Boolean).join(" ").slice(0, 150);
  const url = new URL(SEARCH_URL);
  url.search = new URLSearchParams({
    key: process.env.IMAGE_SEARCH_API_KEY as string,
    cx: process.env.IMAGE_SEARCH_ENGINE_ID as string,
    q: query,
    searchType: "image",
    num: "8",
    safe: "active",
  }).toString();

  let items: GoogleItem[];
  try {
    const response = await fetcher(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`search ${response.status}`);
    items = ((await response.json()) as { items?: GoogleItem[] }).items ?? [];
  } catch {
    return { candidates: [], unavailable: true };
  }

  const candidates: WebCandidate[] = [];
  for (const item of items) {
    if (candidates.length >= MAX_CANDIDATES) break;
    const imageUrl = typeof item.link === "string" ? item.link : "";
    const thumbUrl = typeof item.image?.thumbnailLink === "string" ? item.image.thumbnailLink : "";
    const pageUrl = typeof item.image?.contextLink === "string" ? item.image.contextLink : "";
    if (!imageUrl.startsWith("https://") || !pageUrl.startsWith("https://")) continue;
    try {
      if (!THUMB_HOST.test(new URL(thumbUrl).hostname)) continue;
      const thumb = await downloadPublicImage(thumbUrl, fetcher, resolve, MAX_THUMB_BYTES);
      candidates.push({
        token: signCandidate({ imageUrl, pageUrl, orgId: ctx.orgId }),
        thumbnail: `data:image/jpeg;base64,${Buffer.from(thumb).toString("base64")}`,
        title: (typeof item.title === "string" ? item.title : "").slice(0, 120),
        site: (typeof item.displayLink === "string" ? item.displayLink : new URL(pageUrl).hostname).slice(0, 80),
      });
    } catch {
      // A preview that can't be fetched is simply not offered.
    }
  }
  return { candidates, unavailable: false };
}

/** The supplier picked a web photo: download it, store it as their own private upload, remember the page. */
export async function applyWebImage(
  ctx: OrgCtx,
  productId: string,
  token: string,
  storage: ImageStorage,
  fetcher: Fetcher = fetch,
  resolve: Resolver = defaultResolver,
): Promise<"attached" | "failed"> {
  assertCatalogWritable(ctx);
  if (!isUuid(productId)) throw new NotFoundError("product");
  const candidate = readCandidate(token, ctx.orgId);
  if (!candidate) return "failed";
  const [product] = await getDb()
    .select({ id: products.id, imagePath: products.imagePath })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.supplierOrgId, ctx.orgId)));
  if (!product) throw new NotFoundError("product");
  if (product.imagePath) return "failed";
  await consumeRateLimit(RATE_LIMITS.imageUpload, ctx.orgId);

  let variants;
  try {
    variants = await processProductImage(await downloadPublicImage(candidate.imageUrl, fetcher, resolve));
  } catch {
    return "failed";
  }
  const prefix = newImagePathPrefix(ctx.orgId, product.id);
  const paths = imageFilePaths(prefix);
  await Promise.all(variants.map((v, i) => storage.put(paths[i], v.body, "image/webp")));
  const updated = await getDb()
    .update(products)
    .set({ imagePath: prefix, imageSource: "own", imageSourceUrl: candidate.pageUrl })
    .where(and(eq(products.id, product.id), eq(products.supplierOrgId, ctx.orgId), isNull(products.imagePath)))
    .returning({ id: products.id });
  if (updated.length === 0) {
    await storage.remove(paths).catch(() => {});
    return "failed";
  }
  return "attached";
}
