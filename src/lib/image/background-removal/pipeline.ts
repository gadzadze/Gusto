import { OUTPUT_SIZE, WORK_MAX_SIDE } from "./config";
import { alphaBounds, logitsToAlpha, MODEL_SIZE, maskCoverage, placeInSquare, rgbaToModelInput } from "./math";

// The image half of the background remover (needs canvas, so it runs in a worker or a
// page, not in Node). The model itself is passed in as `inferLogits`, which keeps this
// code testable with a model run somewhere else.

export class PipelineError extends Error {
  constructor() {
    super("no subject found");
  }
}

/** Cuts the subject out of a photo and centres it on a flat white square. */
export async function cutOutOnWhite(
  file: Blob,
  inferLogits: (input: Float32Array) => Promise<Float32Array>,
  onStage: (stage: "run" | "finish") => void = () => undefined,
): Promise<{ blob: Blob; coverage: number }> {
  // Decode (honouring the EXIF rotation) and shrink to a working size.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, WORK_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const work = new OffscreenCanvas(width, height);
  const workCtx = work.getContext("2d", { willReadFrequently: true })!;
  workCtx.fillStyle = "#fff"; // transparent PNGs become white before the model sees them
  workCtx.fillRect(0, 0, width, height);
  workCtx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const source = workCtx.getImageData(0, 0, width, height);

  // Model input: the whole photo squeezed to 1024x1024.
  onStage("run");
  const small = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
  const smallCtx = small.getContext("2d", { willReadFrequently: true })!;
  smallCtx.imageSmoothingQuality = "high";
  smallCtx.drawImage(work, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const input = rgbaToModelInput(smallCtx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data);
  const logits = await inferLogits(input);
  const alphaSmall = logitsToAlpha(logits);

  // Scale the mask back up to the working size.
  const maskImage = new ImageData(MODEL_SIZE, MODEL_SIZE);
  for (let i = 0; i < alphaSmall.length; i++) {
    maskImage.data[i * 4] = maskImage.data[i * 4 + 1] = maskImage.data[i * 4 + 2] = alphaSmall[i];
    maskImage.data[i * 4 + 3] = 255;
  }
  small.getContext("2d")!.putImageData(maskImage, 0, 0);
  const big = new OffscreenCanvas(width, height);
  const bigCtx = big.getContext("2d", { willReadFrequently: true })!;
  bigCtx.imageSmoothingQuality = "high";
  bigCtx.drawImage(small, 0, 0, width, height);
  const maskBig = bigCtx.getImageData(0, 0, width, height).data;
  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = maskBig[i * 4];
    source.data[i * 4 + 3] = alpha[i];
  }

  const coverage = maskCoverage(alpha);
  const box = alphaBounds(alpha, width, height);
  if (!box) throw new PipelineError();

  // Cut out, crop to the subject, centre on a flat white square.
  onStage("finish");
  const cutout = new OffscreenCanvas(width, height);
  cutout.getContext("2d")!.putImageData(source, 0, 0);
  const out = new OffscreenCanvas(OUTPUT_SIZE, OUTPUT_SIZE);
  const outCtx = out.getContext("2d")!;
  outCtx.fillStyle = "#fff";
  outCtx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  outCtx.imageSmoothingQuality = "high";
  const to = placeInSquare(box, OUTPUT_SIZE);
  outCtx.drawImage(cutout, box.x, box.y, box.width, box.height, to.x, to.y, to.width, to.height);
  const blob = await out.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  return { blob, coverage };
}

