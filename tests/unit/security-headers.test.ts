import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";

async function headers(): Promise<Map<string, string>> {
  const rules = await nextConfig.headers!();
  const all = rules.find((r) => r.source === "/:path*");
  expect(all, "a rule for every path").toBeDefined();
  return new Map(all!.headers.map((h) => [h.key, h.value]));
}

describe("security headers (next.config)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sets the required headers on every path", async () => {
    const h = await headers();
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Strict-Transport-Security")).toMatch(/max-age=\d+/);
    expect(h.get("Permissions-Policy")).toContain("camera=()");
  });

  it("CSP allows only this app, Supabase and fonts, and forbids framing, plugins and foreign forms", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const csp = (await headers()).get("Content-Security-Policy")!;
    const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
    expect(directive("form-action")).toBe("form-action 'self'");
    expect(directive("font-src")).toContain("'self'");
    // No wildcard sources anywhere, and no third-party hosts other than the Supabase project.
    expect(csp).not.toMatch(/(^|\s)\*(\s|;|$)/);
    expect(csp).not.toContain("http:");
    for (const d of ["script-src", "style-src", "connect-src", "img-src"]) {
      const hosts = directive(d).split(" ").filter((v) => v.startsWith("https://"));
      // The one exception: connections to Hugging Face, where the background remover's
      // model file (pinned and hash-checked) is downloaded once per device.
      // And img-src: thumbnails of photo suggestions from Open Food Facts (the picked photo is copied to our storage).
      const allowed = d === "connect-src" ? ["https://huggingface.co", "https://*.hf.co"] : d === "img-src" ? ["https://images.openfoodfacts.org"] : [];
      expect(hosts, d).toEqual(allowed);
    }
    expect(directive("script-src")).toContain("'wasm-unsafe-eval'"); // WebAssembly only, not string eval
    expect(directive("script-src")).not.toContain("'unsafe-eval'"); // only development needs it
  });

  it("includes the Supabase origin for images and connections when configured", async () => {
    const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcd1234.supabase.co/some/path";
    try {
      const csp = (await headers()).get("Content-Security-Policy")!;
      expect(csp).toContain("img-src 'self' data: blob: https://abcd1234.supabase.co https://images.openfoodfacts.org");
      expect(csp).toContain("connect-src 'self' https://abcd1234.supabase.co");
      expect(csp).not.toContain("/some/path");
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
    }
  });
});
