import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import { demoPassword, isDemoMode } from "@/lib/demo";

afterEach(() => vi.unstubAllEnvs());

describe("demo mode", () => {
  it("is off unless DEMO_MODE is exactly 1", () => {
    expect(isDemoMode()).toBe(false);
    vi.stubEnv("DEMO_MODE", "true");
    expect(isDemoMode()).toBe(false);
    vi.stubEnv("DEMO_MODE", "1");
    expect(isDemoMode()).toBe(true);
  });

  it("keeps search engines out of the demo only", () => {
    expect(robots().rules).toEqual({ userAgent: "*", allow: "/" });
    vi.stubEnv("DEMO_MODE", "1");
    expect(robots().rules).toEqual({ userAgent: "*", disallow: "/" });
  });

  it("reads the shared demo password from the environment, never from code", () => {
    expect(demoPassword()).toBeNull();
    vi.stubEnv("DEMO_PASSWORD", "  secret-value ");
    expect(demoPassword()).toBe("secret-value");
  });
});
