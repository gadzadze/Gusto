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

export async function callGeminiForOrder(wav: Uint8Array, items: CatalogItem[]): Promise<GeminiOrderCall> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new StateError("not_configured");
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const started = Date.now();
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    // A model call must never hang a request (see "Nothing may hang a request" in CLAUDE.md).
    signal: AbortSignal.timeout(DEADLINE_MS),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [
        {
          role: "user",
          parts: [{ text: catalogPrompt(items) }, { inlineData: { mimeType: "audio/wav", data: Buffer.from(wav).toString("base64") } }],
        },
      ],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
    }),
  });
  if (!response.ok) {
    // Status only: the body can echo the request, which holds the audio and the key's project.
    console.error("[voice] gemini returned", response.status, "for model", model);
    if (response.status === 404) throw new StateError("model_not_found");
    if (response.status === 401 || response.status === 403) throw new StateError("key_rejected");
    if (response.status === 429) throw new StateError("quota");
    throw new StateError("upstream");
  }
  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const out = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
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
    usage: { promptTokens: body.usageMetadata?.promptTokenCount ?? null, outputTokens: body.usageMetadata?.candidatesTokenCount ?? null },
  };
}
