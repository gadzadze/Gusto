import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { voiceOrderEnabled } from "@/server/voice/config";

describe("voice ordering switch", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off by default and needs both the switch and a Gemini key", () => {
    vi.stubEnv("VOICE_ORDER_ENABLED", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(voiceOrderEnabled()).toBe(false);
    vi.stubEnv("VOICE_ORDER_ENABLED", "1");
    expect(voiceOrderEnabled()).toBe(false);
    vi.stubEnv("GEMINI_API_KEY", "k");
    expect(voiceOrderEnabled()).toBe(true);
    vi.stubEnv("VOICE_ORDER_ENABLED", "true");
    expect(voiceOrderEnabled()).toBe(false);
  });
});
