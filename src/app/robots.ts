import type { MetadataRoute } from "next";
import { isDemoMode } from "@/lib/demo";

// The public demo holds fictional data and must not show up in search results.
export default function robots(): MetadataRoute.Robots {
  return isDemoMode() ? { rules: { userAgent: "*", disallow: "/" } } : { rules: { userAgent: "*", allow: "/" } };
}
