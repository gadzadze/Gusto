/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/webgpu";
import { MODEL_CACHE, MODELS, OUTPUT_SIZE, WASM_BASE, WORK_MAX_SIDE, type ModelVariant } from "./config";
import { alphaBounds, logitsToAlpha, MODEL_SIZE, maskCoverage, placeInSquare, rgbaToModelInput } from "./math";
import type { Provider, WorkerRequest, WorkerResponse } from "./messages";

// Runs in a Web Worker so the page stays responsive. Pipeline: decode the photo,
// run BiRefNet-lite on WebGPU, cut the subject out, centre it on a flat white
// square and hand back a JPEG.

const post = (message: WorkerResponse) => (self as unknown as Worker).postMessage(message);

class StageError extends Error {
  constructor(public code: Extract<WorkerResponse, { type: "error" }>["code"]) {
    super(code);
  }
}

let session: ort.InferenceSession | null = null;
let sessionVariant: string | null = null;

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function downloadModel(variant: ModelVariant): Promise<ArrayBuffer> {
  const model = MODELS[variant];
  const cache = await caches.open(MODEL_CACHE).catch(() => null);
  const cached = await cache?.match(model.url);
  if (cached) return cached.arrayBuffer();

  let response: Response;
  try {
    response = await fetch(model.url);
    if (!response.ok || !response.body) throw new Error("bad response");
  } catch {
    throw new StageError("download");
  }
  const total = Number(response.headers.get("content-length")) || model.bytes;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    post({ type: "progress", stage: "download", ratio: Math.min(1, received / total) });
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  post({ type: "progress", stage: "verify" });
  if (received !== model.bytes || (await sha256Hex(bytes.buffer)) !== model.sha256) throw new StageError("integrity");
  await cache?.put(model.url, new Response(bytes.buffer.slice(0), { headers: { "content-type": "application/octet-stream" } })).catch(() => undefined);
  return bytes.buffer;
}

async function getSession(variant: ModelVariant, provider: Provider): Promise<ort.InferenceSession> {
  const key = `${variant}:${provider}`;
  if (session && sessionVariant === key) return session;
  if (provider === "webgpu" && !("gpu" in self.navigator)) throw new StageError("no_webgpu");
  ort.env.wasm.wasmPaths = WASM_BASE;
  ort.env.wasm.numThreads = 1; // multi-threading needs cross-origin isolation, which the app does not set
  const buffer = await downloadModel(variant);
  post({ type: "progress", stage: "load" });
  try {
    session = await ort.InferenceSession.create(new Uint8Array(buffer), { executionProviders: [provider], graphOptimizationLevel: "all" });
  } catch {
    throw new StageError("no_webgpu");
  }
  sessionVariant = key;
  return session;
}

async function run(file: Blob, variant: ModelVariant, provider: Provider): Promise<{ blob: Blob; coverage: number }> {
  const model = await getSession(variant, provider);

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
  post({ type: "progress", stage: "run" });
  const small = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
  const smallCtx = small.getContext("2d", { willReadFrequently: true })!;
  smallCtx.imageSmoothingQuality = "high";
  smallCtx.drawImage(work, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const input = rgbaToModelInput(smallCtx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data);
  const output = await model.run({ [model.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, MODEL_SIZE, MODEL_SIZE]) });
  const logits = output[model.outputNames[0]].data as Float32Array;
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
  if (!box) throw new StageError("failed");

  // Cut out, crop to the subject, centre on a flat white square.
  post({ type: "progress", stage: "finish" });
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

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type !== "run") return;
  try {
    const { blob, coverage } = await run(event.data.file, event.data.variant, event.data.provider);
    post({ type: "done", blob, coverage });
  } catch (error) {
    console.error("[background-removal] failed", error instanceof Error ? error.message : String(error));
    post({ type: "error", code: error instanceof StageError ? error.code : "failed" });
  }
};
