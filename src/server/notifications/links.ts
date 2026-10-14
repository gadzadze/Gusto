import "server-only";

/** Public base URL of the app, no trailing slash. Fails loudly if unset. */
export function appUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) throw new Error("NEXT_PUBLIC_APP_URL is not set.");
  return url.replace(/\/+$/, "");
}
