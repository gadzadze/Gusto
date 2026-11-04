// The model is downloaded by the supplier's browser, once, and cached there.
// It is BiRefNet-lite (MIT licence), pinned to one revision and checked against
// a SHA-256 before it is used. The photo itself never leaves the device.

const REVISION = "de15b22ba131738a16dff04aab8bdf8dc32e3ac1";
const BASE = `https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/${REVISION}/onnx`;

export type ModelVariant = "fp16" | "fp32";

export const MODELS: Record<ModelVariant, { url: string; bytes: number; sha256: string }> = {
  // Half the download; needs the WebGPU "shader-f16" feature (most current phones and laptops).
  fp16: {
    url: `${BASE}/model_fp16.onnx`,
    bytes: 114_538_221,
    sha256: "d39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402",
  },
  fp32: {
    url: `${BASE}/model.onnx`,
    bytes: 224_005_088,
    sha256: "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333",
  },
};

/** Browser cache bucket for the downloaded model. */
export const MODEL_CACHE = "gusto-background-removal-v1";

/** Where the onnxruntime WebAssembly files are served from (copied there by scripts/copy-ort.mjs). */
export const WASM_BASE = "/ort/";

/** Photos are shrunk to this longest side before processing; the result is a square of OUTPUT_SIZE. */
export const WORK_MAX_SIDE = 1600;
export const OUTPUT_SIZE = 1200;
