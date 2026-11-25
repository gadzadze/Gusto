import "server-only";
import { RESPONSE_SCHEMA, SYSTEM_INSTRUCTION, catalogPrompt, type CatalogItem } from "@/lib/voice/order-parse";
import { StateError } from "@/server/domain/errors";

// Voice-order experiment: one call to Gemini with the audio and the catalogue, JSON back.
// The key is server-only; with no GEMINI_API_KEY the experiment is simply off.

// An alias that always points at Google's current Flash model: a pinned name (gemini-2.5-flash) returned 404 once retired.
const DEFAULT_MODEL = "gemini-flash-latest";
const DEADLINE_MS = 30_000;

export type GeminiOrderCall = { raw: unknown; model: string; ms: number; usage: { promptTokens: number | null; outputTokens: number | null } };

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

const FALLBACK_MODEL = "gemini-flash-lite-latest";
const RETRY_PAUSE_MS = 1500;

type Attempt = { status: number; body?: GeminiBody };
type GeminiBody = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

async function attemptOnce(model: string, key: string, payload: string): Promise<Attempt> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    // A model call must never hang a request (see "Nothing may hang a request" in CLAUDE.md).
    signal: AbortSignal.timeout(DEADLINE_MS),
    body: payload,
  });
  if (!response.ok) {
    // Status and model only: the body can echo the request, which holds the audio.
    console.error("[voice] gemini returned", response.status, "for model", model);
    return { status: response.status };
  }
  return { status: 200, body: (await response.json()) as GeminiBody };
}

/** 429 and 5xx are Google being busy: worth one more try and then a lighter model. 4xx is our fault and stops at once. */
const isBusy = (status: number) => status === 429 || status >= 500;

export async function callGeminiForOrder(wav: Uint8Array, items: CatalogItem[]): Promise<GeminiOrderCall> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new StateError("not_configured");
  const primary = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const started = Date.now();
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [
      {
        role: "user",
        parts: [{ text: catalogPrompt(items) }, { inlineData: { mimeType: "audio/wav", data: Buffer.from(wav).toString("base64") } }],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
  });

  const plan = [primary, primary, ...(primary === FALLBACK_MODEL ? [] : [FALLBACK_MODEL])];
  let model = primary;
  let last: Attempt = { status: 0 };
  for (let i = 0; i < plan.length; i++) {
    model = plan[i];
    if (i === 1) await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
    try {
      last = await attemptOnce(model, key, payload);
    } catch {
      // Timeout or network trouble counts as busy.
      last = { status: 503 };
    }
    if (last.status === 200 || !isBusy(last.status)) break;
  }

  if (last.status === 404) throw new StateError("model_not_found");
  if (last.status === 401 || last.status === 403) throw new StateError("key_rejected");
  if (last.status === 429) throw new StateError("quota");
  if (isBusy(last.status)) throw new StateError("busy");
  if (last.status !== 200 || !last.body) throw new StateError("upstream");

  const out = last.body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let raw: unknown;
  try {
    raw = JSON.parse(out);
  } catch {
    throw new StateError("upstream");
  }
  return {
    raw,
    model,
    ms: Date.now() - started,
    usage: { promptTokens: last.body.usageMetadata?.promptTokenCount ?? null, outputTokens: last.body.usageMetadata?.candidatesTokenCount ?? null },
  };
}
