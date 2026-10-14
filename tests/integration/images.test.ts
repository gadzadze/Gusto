import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { getSupplierProduct, removeProductImage, setProductImage } from "@/server/domain/catalog/products";
import type { SupplierCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";
import { ImageError, MAX_IMAGE_BYTES, processProductImage } from "@/server/storage/images";
import { createAdmin, createSupplier, createTestCategory, createTestProduct, memoryStorage } from "./helpers";

async function png(width = 1600, height = 900): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#7a1f2b" } }).png().toBuffer();
}

describe("processProductImage", () => {
  it("re-encodes JPEG/PNG/WebP to WebP at 400 and 1200px, without enlarging", async () => {
    const jpeg = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#000" } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: "secret-gps-placeholder" } } })
      .toBuffer();
    const out = await processProductImage(jpeg);
    expect(out.map((v) => v.width)).toEqual([400, 1200]);
    for (const variant of out) {
      const meta = await sharp(variant.body).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(variant.width);
      expect(meta.exif).toBeUndefined();
    }
    const small = await processProductImage(await png(300, 200));
    expect((await sharp(small[1].body).metadata()).width).toBe(300);
  });

  it("rejects a renamed executable", async () => {
    const exe = Buffer.concat([Buffer.from("MZ\x90\x00", "binary"), Buffer.alloc(2048, 1)]);
    await expect(processProductImage(exe)).rejects.toEqual(new ImageError("unsupported"));
  });

  it("rejects SVG and GIF even though they are images", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    await expect(processProductImage(svg)).rejects.toEqual(new ImageError("unsupported"));
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).gif().toBuffer();
    await expect(processProductImage(gif)).rejects.toEqual(new ImageError("unsupported"));
  });

  it("rejects empty and oversized files before decoding", async () => {
    await expect(processProductImage(new Uint8Array())).rejects.toEqual(new ImageError("empty"));
    await expect(processProductImage(new Uint8Array(MAX_IMAGE_BYTES + 1))).rejects.toEqual(new ImageError("too_large"));
  });
});

describe("setProductImage", () => {
  let supplier: SupplierCtx;
  let productId: string;

  beforeAll(async () => {
    const admin = await createAdmin();
    const category = await createTestCategory(admin);
    supplier = await createSupplier();
    productId = await createTestProduct(supplier, category.id);
  });

  it("stores both sizes under the supplier's prefix, replaces and removes the old image", async () => {
    const storage = memoryStorage();
    const first = await setProductImage(supplier, productId, await png(), storage);
    expect(first.startsWith(`${supplier.orgId}/${productId}/`)).toBe(true);
    expect([...storage.files.keys()].sort()).toEqual([`${first}-w1200.webp`, `${first}-w400.webp`]);

    const second = await setProductImage(supplier, productId, await png(800, 800), storage);
    expect((await getSupplierProduct(supplier, productId)).imagePath).toBe(second);
    expect(storage.removed.sort()).toEqual([`${first}-w1200.webp`, `${first}-w400.webp`]);
    expect([...storage.files.keys()].every((k) => k.startsWith(second))).toBe(true);

    await removeProductImage(supplier, productId, storage);
    expect((await getSupplierProduct(supplier, productId)).imagePath).toBeNull();
    expect(storage.files.size).toBe(0);
  });

  it("does not store anything for another supplier's product or an invalid file", async () => {
    const other = await createSupplier();
    const storage = memoryStorage();
    await expect(setProductImage(other, productId, await png(), storage)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setProductImage(supplier, productId, Buffer.from("not an image"), storage)).rejects.toEqual(
      new ImageError("unsupported"),
    );
    expect(storage.files.size).toBe(0);
  });
});
