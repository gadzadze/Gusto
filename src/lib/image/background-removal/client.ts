import type { ModelVariant } from "./config";
import type { Provider, WorkerRequest, WorkerResponse } from "./messages";

export type Capability = { supported: false } | { supported: true; variant: ModelVariant; provider: Provider };

/**
 * Where the model can run: on the GPU (WebGPU) where there is one, otherwise on
 * the CPU (WebAssembly), which works anywhere but is much slower and needs the
 * bigger model file. Devices that report little memory are left out.
 */
export async function detectCapability(): Promise<Capability> {
  try {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof WebAssembly === "undefined") return { supported: false };
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> } }).gpu;
    const adapter = gpu ? await gpu.requestAdapter() : null;
    if (adapter) return { supported: true, provider: "webgpu", variant: adapter.features.has("shader-f16") ? "fp16" : "fp32" };
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (memory !== undefined && memory < 4) return { supported: false };
    return { supported: true, provider: "wasm", variant: "fp32" };
  } catch {
    return { supported: false };
  }
}

export type Progress = Extract<WorkerResponse, { type: "progress" }>;
export type RemovalError = Extract<WorkerResponse, { type: "error" }>["code"];

export class RemovalFailure extends Error {
  constructor(public code: RemovalError) {
    super(code);
  }
}

let worker: Worker | null = null;

/** Cuts the subject out of a photo, on this device. Resolves with a white-background JPEG. */
export function removeBackground(
  file: File,
  variant: ModelVariant,
  provider: Provider,
  onProgress: (progress: Progress) => void,
): Promise<{ file: File; coverage: number }> {
  worker ??= new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const current = worker;
  return new Promise((resolve, reject) => {
    current.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") onProgress(message);
      else if (message.type === "done") {
        const base = file.name.replace(/\.[^.]+$/, "") || "photo";
        resolve({ file: new File([message.blob], `${base}-clean.jpg`, { type: "image/jpeg" }), coverage: message.coverage });
      } else reject(new RemovalFailure(message.code));
    };
    current.onerror = () => {
      worker = null;
      reject(new RemovalFailure("failed"));
    };
    const request: WorkerRequest = { type: "run", file, variant, provider };
    current.postMessage(request);
  });
}
