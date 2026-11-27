import "server-only";
import { geminiConfigured } from "@/server/voice/gemini";

/**
 * Voice ordering for buyers is off until `VOICE_ORDER_ENABLED=1` (and a Gemini key) is set. It stays a switch because it sends the
 * buyer's voice to Google (the privacy text lists that) and live audio costs money while a session is open.
 */
export function voiceOrderEnabled(): boolean {
  return process.env.VOICE_ORDER_ENABLED === "1" && geminiConfigured();
}
