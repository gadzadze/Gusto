// Regenerates the app icons from the logo artwork: the word "Gusto" in white on
// the brand burgundy. Run `npm run brand:icons`; never hand-edit the outputs.
//
//   src/app/icon.svg        1024 square, rounded corners (browser tabs, Android)
//   src/app/apple-icon.png  180 square, full bleed (iOS rounds it itself)
//   src/app/favicon.ico     16 / 32 / 48, the letter "G" only: the whole word is
//                           unreadable at tab size
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BURGUNDY = "#6E0018"; // the colour of the wordmark artwork itself
const WORD_W = 1160;
const WORD_H = 329;

const source = await readFile(path.join(root, "public/brand/gusto-wordmark.svg"), "utf8");
if (!source.includes(BURGUNDY)) throw new Error(`Wordmark no longer uses ${BURGUNDY}; update gen-icons.mjs.`);
const whiteWordmark = source.split(BURGUNDY).join("#FFFFFF");
const inner = whiteWordmark.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

/** The white word, centred in a square of `size`, `wordWidth` wide, on burgundy. */
function square(size, wordWidth, radius) {
  const wordHeight = (wordWidth * WORD_H) / WORD_W;
  const x = (size - wordWidth) / 2;
  const y = (size - wordHeight) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${radius}" fill="${BURGUNDY}"/>` +
    `<svg x="${x}" y="${y}" width="${wordWidth}" height="${wordHeight}" viewBox="0 0 ${WORD_W} ${WORD_H}">${inner}</svg>` +
    `</svg>`
  );
}

// 1. icon.svg: ~15% margin each side.
const iconSvg = square(1024, 760, 228);
await writeFile(path.join(root, "src/app/icon.svg"), iconSvg);

// 2. apple-icon.png: no rounding (iOS masks it), no transparency.
await sharp(Buffer.from(square(1024, 760, 0)), { density: 300 })
  .resize(180, 180)
  .flatten({ background: BURGUNDY })
  .png()
  .toFile(path.join(root, "src/app/apple-icon.png"));

// 3. favicon.ico: crop the "G" out of a raster of the white word.
const raster = await sharp(Buffer.from(whiteWordmark), { density: 300 })
  .resize({ width: 2320 })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { data, info } = raster;
const columnHasInk = (cx) => {
  for (let cy = 0; cy < info.height; cy++) if (data[(cy * info.width + cx) * 4 + 3] > 40) return true;
  return false;
};
let left = 0;
while (left < info.width && !columnHasInk(left)) left++;
let right = left;
while (right < info.width && columnHasInk(right)) right++; // first gap = end of the "G"
const letter = await sharp(Buffer.from(whiteWordmark), { density: 300 })
  .resize({ width: 2320 })
  .extract({ left, top: 0, width: right - left, height: info.height })
  .trim()
  .png()
  .toBuffer();

async function faviconPng(size) {
  const inset = Math.round(size * 0.2);
  const glyph = await sharp(letter)
    .resize({ width: size - 2 * inset, height: size - 2 * inset, fit: "inside" })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BURGUNDY } })
    .composite([{ input: glyph, gravity: "centre" }])
    .png()
    .toBuffer();
}

const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(faviconPng));
// ICO container holding PNG images (supported by every current browser).
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
