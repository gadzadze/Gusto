import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { products, sharedProductImages } from "@/server/db/schema";
import { findPhotos, listPhotoCandidates } from "@/server/domain/catalog/photo-fetch";
import { removeProductImage, setProductImage } from "@/server/domain/catalog/products";
import type { AdminCtx } from "@/server/domain/context";
import { createAdmin, createSupplier, createTestCategory, createTestProduct, memoryStorage } from "./helpers";

let admin: AdminCtx;
let categoryId: string;
beforeAll(async () => {
  admin = await createAdmin();
  categoryId = (await createTestCategory(admin)).id;
});

const barcodeFor = () => String(Math.floor(1e12 + Math.random() * 9e12));

async function productWithBarcode(supplier: Awaited<ReturnType<typeof createSupplier>>, barcode: string | null) {
  const id = await createTestProduct(supplier, categoryId);
  await getDb().update(products).set({ barcode }).where(eq(products.id, id));
  return id;
}

async function png() {
  return sharp({ create: { width: 40, height: 40, channels: 3, background: "#cc3333" } }).png().toBuffer();
}

/** A fake Open Food Facts: `known` barcodes have a photo; `calls` records every URL asked for. */
function fakeOff(known: string[], image: Buffer) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    if (u.hostname === "world.openfoodfacts.org") {
      const code = u.pathname.split("/").pop()!.replace(".json", "");
      if (!known.includes(code)) return new Response("{}", { status: 404 });
      return Response.json({ product: { image_front_url: `https://images.openfoodfacts.org/images/products/${code}/front.400.jpg` } });
    }
    if (u.hostname === "images.openfoodfacts.org") return new Response(new Uint8Array(image), { headers: { "content-type": "image/png" } });
    throw new Error(`unexpected host ${u.hostname}`);
  };
  return { fetcher, calls };
}

describe("automatic product photos", () => {
  it("attaches a photo by barcode, reports missing ones, and leaves products without a barcode alone", async () => {
    const supplier = await createSupplier();
    const storage = memoryStorage();
    const found = barcodeFor();
    const unknown = barcodeFor();
    const a = await productWithBarcode(supplier, found);
    const b = await productWithBarcode(supplier, unknown);
    const c = await productWithBarcode(supplier, null);
    const { fetcher } = fakeOff([found], await png());

    expect(new Set(await listPhotoCandidates(supplier))).toEqual(new Set([a, b]));
    const result = await findPhotos(supplier, [a, b, c], storage, fetcher);
    expect(result).toEqual({ attached: 1, notFound: 1, failed: 0 });

    const rows = await getDb().select().from(products).where(eq(products.supplierOrgId, supplier.orgId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(a)).toMatchObject({ imageSource: "shared" });
    expect(byId.get(a)?.imagePath).toMatch(/^shared\//);
    expect(byId.get(b)?.imagePath).toBeNull();
    expect(byId.get(c)?.imagePath).toBeNull();
  });

  it("reuses the shared photo for another supplier without asking the internet again", async () => {
    const barcode = barcodeFor();
    const first = await createSupplier();
    const second = await createSupplier();
    const storage = memoryStorage();
    const p1 = await productWithBarcode(first, barcode);
    const p2 = await productWithBarcode(second, barcode);
    const off = fakeOff([barcode], await png());

    await findPhotos(first, [p1], storage, off.fetcher);
    const callsAfterFirst = off.calls.length;
    const result = await findPhotos(second, [p2], storage, off.fetcher);
    expect(result.attached).toBe(1);
    expect(off.calls.length).toBe(callsAfterFirst);
    const [a] = await getDb().select().from(products).where(eq(products.id, p1));
    const [b] = await getDb().select().from(products).where(eq(products.id, p2));
    expect(b.imagePath).toBe(a.imagePath);
    expect(await getDb().select().from(sharedProductImages).where(eq(sharedProductImages.barcode, barcode))).toHaveLength(1);
  });

  it("never replaces a photo the supplier already has, and never puts a supplier upload in the library", async () => {
    const supplier = await createSupplier();
    const storage = memoryStorage();
    const barcode = barcodeFor();
    const id = await productWithBarcode(supplier, barcode);
    await setProductImage(supplier, id, new Uint8Array(await png()), storage);
    const off = fakeOff([barcode], await png());

    expect(await findPhotos(supplier, [id], storage, off.fetcher)).toEqual({ attached: 0, notFound: 0, failed: 0 });
    expect(off.calls).toHaveLength(0);
    expect(await getDb().select().from(sharedProductImages).where(eq(sharedProductImages.barcode, barcode))).toHaveLength(0);
    const [row] = await getDb().select().from(products).where(eq(products.id, id));
    expect(row.imageSource).toBe("own");
  });

  it("removing or replacing a shared photo never deletes the shared files", async () => {
    const supplier = await createSupplier();
    const other = await createSupplier();
    const storage = memoryStorage();
    const barcode = barcodeFor();
    const mine = await productWithBarcode(supplier, barcode);
    const theirs = await productWithBarcode(other, barcode);
    const off = fakeOff([barcode], await png());
    await findPhotos(supplier, [mine], storage, off.fetcher);
    await findPhotos(other, [theirs], storage, off.fetcher);
    const filesBefore = new Set(storage.files.keys());

    await removeProductImage(supplier, mine, storage);
    expect(storage.removed).toEqual([]);
    expect(new Set(storage.files.keys())).toEqual(filesBefore);
    const [after] = await getDb().select().from(products).where(eq(products.id, mine));
    expect(after).toMatchObject({ imagePath: null, imageSource: "own" });
    const [still] = await getDb().select().from(products).where(eq(products.id, theirs));
    expect(still.imagePath).toMatch(/^shared\//);

    // Replacing a shared photo with an own upload also leaves the shared files alone.
    await setProductImage(other, theirs, new Uint8Array(await png()), storage);
    expect(storage.removed).toEqual([]);
    const [replaced] = await getDb().select().from(products).where(eq(products.id, theirs));
    expect(replaced.imageSource).toBe("own");
  });

  it("only ever fetches images from the Open Food Facts image host", async () => {
    const supplier = await createSupplier();
    const storage = memoryStorage();
    const barcode = barcodeFor();
    const id = await productWithBarcode(supplier, barcode);
    const calls: string[] = [];
    const evil = async (url: string) => {
      calls.push(url);
      if (url.includes("world.openfoodfacts.org")) return Response.json({ product: { image_front_url: "https://evil.example/x.png" } });
      throw new Error("must not fetch");
    };
    const result = await findPhotos(supplier, [id], storage, evil);
    expect(result).toEqual({ attached: 0, notFound: 1, failed: 0 });
    expect(calls).toHaveLength(1);
  });

  it("counts a service outage as failed (to retry), not as 'no photo'", async () => {
    const supplier = await createSupplier();
    const id = await productWithBarcode(supplier, barcodeFor());
    const down = async () => new Response("busy", { status: 503 });
    expect(await findPhotos(supplier, [id], memoryStorage(), down)).toEqual({ attached: 0, notFound: 0, failed: 1 });
  });
});
