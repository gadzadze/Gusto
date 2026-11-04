// Pure helpers for the in-browser background remover (no DOM, so they are
// unit-tested in Node). The model is BiRefNet-lite (MIT): a 1024x1024 RGB
// image, ImageNet-normalised, in; a 1024x1024 logit map out.

export const MODEL_SIZE = 1024;
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/** RGBA pixels (MODEL_SIZE x MODEL_SIZE) -> planar float32 CHW, normalised. */
export function rgbaToModelInput(rgba: ArrayLike<number>, size = MODEL_SIZE): Float32Array {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      out[c * plane + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
    }
  }
  return out;
}

/** Logits -> 0..255 alpha by sigmoid. */
export function logitsToAlpha(logits: ArrayLike<number>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(logits.length);
  for (let i = 0; i < logits.length; i++) out[i] = Math.round(255 / (1 + Math.exp(-logits[i])));
  return out;
}

export type Box = { x: number; y: number; width: number; height: number };

/** Bounding box of pixels whose alpha is above `threshold`, or null if there are none. */
export function alphaBounds(alpha: ArrayLike<number>, width: number, height: number, threshold = 24): Box | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Where to draw a cropped subject so it is centred in a square canvas with a
 * margin (default 8% each side) and never upscaled beyond `maxUpscale`.
 */
export function placeInSquare(
  subject: { width: number; height: number },
  canvas: number,
  margin = 0.08,
  maxUpscale = 3,
): { x: number; y: number; width: number; height: number } {
  const inner = canvas * (1 - 2 * margin);
  const scale = Math.min(inner / subject.width, inner / subject.height, maxUpscale);
  const width = Math.max(1, Math.round(subject.width * scale));
  const height = Math.max(1, Math.round(subject.height * scale));
  return { x: Math.round((canvas - width) / 2), y: Math.round((canvas - height) / 2), width, height };
}

/**
 * A cut-out that kept (almost) nothing, or (almost) everything, is a failure
 * worth telling the supplier about rather than silently saving.
 */
export function maskCoverage(alpha: ArrayLike<number>, threshold = 128): number {
  let on = 0;
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > threshold) on++;
  return alpha.length === 0 ? 0 : on / alpha.length;
}
