// Copies the onnxruntime-web WebAssembly file used by the background remover into
// public/ort, so the browser loads it from our own origin (the CSP does not allow
// a CDN). Runs before dev and build; the copy is git-ignored.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "node_modules/onnxruntime-web/dist");
const to = path.join(root, "public/ort");
// onnxruntime-web picks the "jspi" build where the browser supports JSPI and "asyncify" elsewhere.
const files = [
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.jspi.mjs",
  "ort-wasm-simd-threaded.jspi.wasm",
];

mkdirSync(to, { recursive: true });
for (const file of files) {
  if (!existsSync(path.join(from, file))) throw new Error(`Missing ${file} in onnxruntime-web; update scripts/copy-ort.mjs.`);
  copyFileSync(path.join(from, file), path.join(to, file));
}
console.log(`Copied ${files.length} onnxruntime-web files to public/ort`);
