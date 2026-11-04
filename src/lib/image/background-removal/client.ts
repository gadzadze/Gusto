import type { ModelVariant } from "./config";
import type { WorkerRequest, WorkerResponse } from "./messages";

export type Capability = { supported: false } | { supported: true; variant: ModelVariant };

/**
 * Background removal needs WebGPU: the model's working memory (several GB at
 * 1024x1024) is more than a browser's WebAssembly can address, so there is no
 * CPU fallback. Decides which model file this device can run.
 */
export async function detectCapability(): Promise<Capability> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> } }).gpu;
    if (!gpu || typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return { supported: false };
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { supported: false };
    return { supported: true, variant: adapter.features.has("shader-f16") ? "fp16" : "fp32" };
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
    const request: WorkerRequest = { type: "run", file, variant };
    current.postMessage(request);
  });
}
