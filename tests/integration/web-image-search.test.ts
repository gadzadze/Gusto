import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/server/db/client";
import { products, sharedProductImages } from "@/server/db/schema";
import {
  applyWebImage,
  downloadPublicImage,
  isPublicAddress,
  readCandidate,
  searchWebImages,
  signCandidate,
} from "@/server/domain/catalog/web-image-search";
import { removeProductImage } from "@/server/domain/catalog/products";
import type { AdminCtx } from "@/server/domain/context";
import { createAdmin, createSupplier, createTestCategory, createTestProduct, memoryStorage } from "./helpers";

let admin: AdminCtx;
let categoryId: string;
beforeAll(async () => {
  admin = await createAdmin();
  categoryId = (await createTestCategory(admin)).id;
  vi.stubEnv("IMAGE_SEARCH_API_KEY", "test-key");
  vi.stubEnv("IMAGE_SEARCH_ENGINE_ID", "test-cx");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
});

const publicDns = async () => ["93.184.216.34"];
const png = () => sharp({ create: { width: 50, height: 50, channels: 3, background: "#3366cc" } }).png().toBuffer();

function fakeWeb(image: Buffer) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    if (u.hostname === "www.googleapis.com") {
      return Response.json({
        items: [
          { link: "https://shop.example/p/1.jpg", title: "Water", displayLink: "shop.example", image: { thumbnailLink: "https://encrypted-tbn0.gstatic.com/t1", contextLink: "https://shop.example/p/1" } },
          { link: "http://insecure.example/2.jpg", title: "Insecure", image: { thumbnailLink: "https://encrypted-tbn0.gstatic.com/t2", contextLink: "https://x.example/2" } },
          { link: "https://other.example/3.jpg", title: "Odd preview host", image: { thumbnailLink: "https://evil.example/t3", contextLink: "https://other.example/3" } },
        ],
      });
    }
    return new Response(new Uint8Array(image), { headers: { "content-type": "image/png" } });
  };
  return { fetcher, calls };
}

describe("web photo search", () => {
  it("offers previews, applies the picked photo as a private upload with its source, and shares nothing", async () => {
    const supplier = await createSupplier();
    const storage = memoryStorage();
    const id = await createTestProduct(supplier, categoryId);
    const web = fakeWeb(await png());

    const outcome = await searchWebImages(supplier, id, web.fetcher, publicDns);
    expect(outcome.unavailable).toBe(false);
    // Only the https result with a gstatic preview is offered.
    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.candidates[0].thumbnail).toMatch(/^data:image\/jpeg;base64,/);
    expect((await getDb().select().from(products).where(eq(products.id, id)))[0].imagePath).toBeNull();

    expect(await applyWebImage(supplier, id, outcome.candidates[0].token, storage, web.fetcher, publicDns)).toBe("attached");
    const [row] = await getDb().select().from(products).where(eq(products.id, id));
    expect(row).toMatchObject({ imageSource: "own", imageSourceUrl: "https://shop.example/p/1" });
    expect(row.imagePath).not.toMatch(/^shared\//);
    expect(await getDb().select().from(sharedProductImages)).not.toContainEqual(expect.objectContaining({ imagePath: row.imagePath }));

    // It is the supplier's own photo now: removing it deletes it and forgets the source.
    await removeProductImage(supplier, id, storage);
    const [after] = await getDb().select().from(products).where(eq(products.id, id));
    expect(after).toMatchObject({ imagePath: null, imageSourceUrl: null });
    expect(storage.removed.length).toBeGreaterThan(0);
  });

  it("accepts only tokens this server signed, for the supplier they were issued to", async () => {
    const supplier = await createSupplier();
    const other = await createSupplier();
    const id = await createTestProduct(supplier, categoryId);
    const storage = memoryStorage();
    const web = fakeWeb(await png());
    const token = signCandidate({ imageUrl: "https://shop.example/p/1.jpg", pageUrl: "https://shop.example/p/1", orgId: supplier.orgId });

    expect(readCandidate(token, supplier.orgId)).not.toBeNull();
    expect(readCandidate(token, other.orgId)).toBeNull();
    expect(readCandidate(`${token}x`, supplier.orgId)).toBeNull();
    const forged = `${Buffer.from(JSON.stringify({ imageUrl: "https://evil.example/a.png", pageUrl: "https://evil.example", orgId: supplier.orgId })).toString("base64url")}.AAAA`;
    expect(await applyWebImage(supplier, id, forged, storage, web.fetcher, publicDns)).toBe("failed");
    expect(web.calls).toHaveLength(0);
  });

  it("refuses to download from non-public addresses, redirects to them, or non-https URLs", async () => {
    expect(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"].some(isPublicAddress)).toBe(false);
    expect(isPublicAddress("93.184.216.34")).toBe(true);

    const never = async () => {
      throw new Error("must not be called");
    };
    await expect(downloadPublicImage("http://shop.example/a.png", never, publicDns)).rejects.toThrow("blocked url");
    await expect(downloadPublicImage("https://internal.example/a.png", never, async () => ["10.0.0.5"])).rejects.toThrow("blocked host");
    const redirect = async () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } });
    await expect(downloadPublicImage("https://shop.example/a.png", redirect, publicDns)).rejects.toThrow("blocked host");
  });

  it("does nothing, and asks nothing, when the search is not configured", async () => {
    vi.stubEnv("IMAGE_SEARCH_API_KEY", "");
    try {
      const supplier = await createSupplier();
      const id = await createTestProduct(supplier, categoryId);
      const web = fakeWeb(await png());
      expect(await searchWebImages(supplier, id, web.fetcher, publicDns)).toEqual({ candidates: [], unavailable: false });
      expect(web.calls).toHaveLength(0);
    } finally {
      vi.stubEnv("IMAGE_SEARCH_API_KEY", "test-key");
    }
  });
});
