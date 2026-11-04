/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/webgpu";
import { MODEL_CACHE, MODELS, WASM_BASE, type ModelVariant } from "./config";
import { MODEL_SIZE } from "./math";
import { cutOutOnWhite, PipelineError } from "./pipeline";
import type { WorkerRequest, WorkerResponse } from "./messages";

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
let sessionVariant: ModelVariant | null = null;

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

async function getSession(variant: ModelVariant): Promise<ort.InferenceSession> {
  if (session && sessionVariant === variant) return session;
  if (!("gpu" in self.navigator)) throw new StageError("no_webgpu");
  ort.env.wasm.wasmPaths = WASM_BASE;
  ort.env.wasm.numThreads = 1; // multi-threading needs cross-origin isolation, which the app does not set
  const buffer = await downloadModel(variant);
  post({ type: "progress", stage: "load" });
  try {
    session = await ort.InferenceSession.create(new Uint8Array(buffer), { executionProviders: ["webgpu"], graphOptimizationLevel: "all" });
  } catch {
    throw new StageError("no_webgpu");
  }
  sessionVariant = variant;
  return session;
}

async function run(file: Blob, variant: ModelVariant): Promise<{ blob: Blob; coverage: number }> {
  const model = await getSession(variant);
  return cutOutOnWhite(
    file,
    async (input) => {
      const output = await model.run({ [model.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, MODEL_SIZE, MODEL_SIZE]) });
      return output[model.outputNames[0]].data as Float32Array;
    },
    (stage) => post({ type: "progress", stage }),
  ).catch((error: unknown) => {
    throw error instanceof PipelineError ? new StageError("failed") : error;
  });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type !== "run") return;
  try {
    const { blob, coverage } = await run(event.data.file, event.data.variant);
    post({ type: "done", blob, coverage });
  } catch (error) {
    console.error("[background-removal] failed", error instanceof Error ? error.message : String(error));
    post({ type: "error", code: error instanceof StageError ? error.code : "failed" });
  }
};
