// Regenerates the app icons from the logo artwork: the number "202" (Nunito ExtraBold,
// outlines in public/brand/202-wordmark.svg) in cream on the brand burgundy. Run
// `npm run brand:icons`; never hand-edit the outputs.
//
//   src/app/icon.svg        1024 square, rounded corners (browser tabs, Android)
//   src/app/apple-icon.png  180 square, full bleed (iOS rounds it itself)
//   src/app/favicon.ico     16 / 32 / 48, the same "202" a little larger
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BURGUNDY = "#7A1F2E";
const CREAM = "#F8F2EC";

const source = await readFile(path.join(root, "public/brand/202-wordmark.svg"), "utf8");
const viewBox = source.match(/viewBox="([^"]+)"/)?.[1];
const pathData = source.match(/ d="([^"]+)"/)?.[1];
if (!viewBox || !pathData) throw new Error("Cannot read public/brand/202-wordmark.svg");
const [vx, vy, vw, vh] = viewBox.split(/\s+/).map(Number);

/** The cream number, centred in a square of `size`, `wordWidth` wide, on burgundy (rounded by `radius`). */
function square(size, wordWidth, radius) {
  const scale = wordWidth / vw;
  const x = (size - wordWidth) / 2 - vx * scale;
  const y = (size - vh * scale) / 2 - vy * scale;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${radius}" fill="${BURGUNDY}"/>` +
    `<path transform="translate(${x} ${y}) scale(${scale})" fill="${CREAM}" d="${pathData}"/>` +
    `</svg>`
  );
}

// 1. icon.svg: the design's proportions (corner radius 22.5%, number 64% of the width).
await writeFile(path.join(root, "src/app/icon.svg"), square(1024, 655, 230));

// 2. apple-icon.png: no rounding (iOS masks it), no transparency.
await sharp(Buffer.from(square(1024, 655, 0)), { density: 300 })
  .resize(180, 180)
  .flatten({ background: BURGUNDY })
  .png()
  .toFile(path.join(root, "src/app/apple-icon.png"));

// 3. favicon.ico: PNG images in an ICO container (supported by every current browser).
const sizes = [16, 32, 48];
const images = await Promise.all(
  sizes.map((size) =>
    sharp(Buffer.from(square(256, 196, 0)), { density: 300 }).resize(size, size).png().toBuffer(),
  ),
);
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);
const directory = Buffer.alloc(16 * images.length);
let offset = header.length + directory.length;
images.forEach((image, index) => {
  const at = index * 16;
  directory.writeUInt8(sizes[index], at);
  directory.writeUInt8(sizes[index], at + 1);
  directory.writeUInt16LE(1, at + 4); // colour planes
  directory.writeUInt16LE(32, at + 6); // bits per pixel
  directory.writeUInt32LE(image.length, at + 8);
  directory.writeUInt32LE(offset, at + 12);
  offset += image.length;
});
await mkdir(path.join(root, "src/app"), { recursive: true });
await writeFile(path.join(root, "src/app/favicon.ico"), Buffer.concat([header, directory, ...images]));

console.log("Wrote src/app/icon.svg, src/app/apple-icon.png, src/app/favicon.ico");
