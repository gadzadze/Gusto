// Messages between the page and the background-removal worker.

import type { ModelVariant } from "./config";

export type WorkerRequest = { type: "run"; file: Blob; variant: ModelVariant };

export type WorkerProgress = { type: "progress"; stage: "download" | "verify" | "load" | "run" | "finish"; ratio?: number };
export type WorkerDone = { type: "done"; blob: Blob; coverage: number };
export type WorkerError = { type: "error"; code: "no_webgpu" | "download" | "integrity" | "failed" };
export type WorkerResponse = WorkerProgress | WorkerDone | WorkerError;
