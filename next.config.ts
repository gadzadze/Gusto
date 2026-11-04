import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { sentryIngestOrigin } from "./src/lib/sentry-dsn";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Content-Security-Policy: this app, Supabase (product images are served from
// its public Storage bucket), Sentry (browser error reports go to the DSN's
// ingest origin) and the fonts (next/font self-hosts them, so 'self' covers them). 'unsafe-inline' is needed for the inline scripts and
// styles Next.js emits; per-request nonces would force every page to render
// dynamically, which Cache Components is there to avoid. 'unsafe-eval' is
// development only (React's debugging features).
function contentSecurityPolicy(): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let supabaseOrigin = "";
  try {
    supabaseOrigin = supabase ? new URL(supabase).origin : "";
  } catch {
    supabaseOrigin = "";
  }
  const sentryOrigin = sentryIngestOrigin();
  const dev = process.env.NODE_ENV !== "production";
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'wasm-unsafe-eval' lets the background remover instantiate onnxruntime's WebAssembly (it allows
    // WebAssembly only, not eval of strings).
    "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...(dev ? ["'unsafe-eval'"] : [])],
    "worker-src": ["'self'", "blob:"],
    "style-src": ["'self'", "'unsafe-inline'"],
    // images.openfoodfacts.org: thumbnails of photo suggestions (the chosen photo is copied to our storage).
    "img-src": ["'self'", "data:", "blob:", ...(supabaseOrigin ? [supabaseOrigin] : []), "https://images.openfoodfacts.org"],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...(supabaseOrigin ? [supabaseOrigin] : []),
      ...(sentryOrigin ? [sentryOrigin] : []),
      // The background remover's model file (MIT, pinned and hash-checked), downloaded once per device.
      "https://huggingface.co",
      "https://*.hf.co",
      ...(dev ? ["ws:", "wss:"] : []),
    ],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: {
      // Product image uploads (max 4 MB, see server/storage/images.ts) plus
      // multipart overhead. Vercel caps function request bodies at 4.5 MB.
      bodySizeLimit: "4.4mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Source maps are uploaded (so production stack traces are readable) only when
// SENTRY_AUTH_TOKEN is set, which keeps `npm run build` working with no
// environment, as CI requires. Telemetry to Sentry about the build is off.
export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  widenClientFileUpload: true,
  // Features that are not used: smaller browser bundle.
  bundleSizeOptimizations: { excludeDebugStatements: true, excludeTracing: true, excludeReplayShadowDom: true },
});
