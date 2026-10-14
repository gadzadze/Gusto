import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Content-Security-Policy: this app, Supabase (product images are served from
// its public Storage bucket) and the fonts (next/font self-hosts them, so
// 'self' covers them). 'unsafe-inline' is needed for the inline scripts and
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
  const dev = process.env.NODE_ENV !== "production";
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...(supabaseOrigin ? [supabaseOrigin] : [])],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(supabaseOrigin ? [supabaseOrigin] : []), ...(dev ? ["ws:", "wss:"] : [])],
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

export default withNextIntl(nextConfig);
