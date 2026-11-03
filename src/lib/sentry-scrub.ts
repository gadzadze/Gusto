import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

// Everything Sentry receives passes through here first. The rule is the one in
// CLAUDE.md ("Never log tokens, magic links, invite URLs, cookies or full
// request bodies"), applied to a third party: events keep the error, the stack
// and the route, and lose request bodies, cookies, headers, query strings,
// secret path segments, user identity and email addresses.

// Also matches the URL-encoded form (a%40b.ge), which is how addresses look in query strings.
const EMAIL = /[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
// Long unbroken URL-safe strings: invitation tokens (43 chars), token hashes,
// OAuth codes, API keys.
const LONG_TOKEN = /[A-Za-z0-9_-]{32,}/g;
// Record ids are kept: they help find the row and are never used for authorization.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Replaces email addresses and token-like strings inside free text. */
export function scrubText(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(JWT, "[token]")
    .replace(LONG_TOKEN, (match) => (UUID.test(match) ? match : "[token]"));
}

/** A URL or path without its query string, hash or secret path segments. */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/);
  const withoutQuery = cut === -1 ? url : url.slice(0, cut);
  return withoutQuery
    .split("/")
    .map((segment, index, all) => (all[index - 1] === "invite" ? "[token]" : scrubText(segment)))
    .join("/");
}

const URL_KEYS = new Set(["url", "from", "to"]);

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const scrubbed: Breadcrumb = { ...breadcrumb };
  if (typeof scrubbed.message === "string") scrubbed.message = scrubText(scrubbed.message);
  if (scrubbed.data) {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(scrubbed.data)) {
      // Console arguments and request bodies can hold anything.
      if (key === "arguments" || key === "body") continue;
      if (typeof value === "string") data[key] = URL_KEYS.has(key) ? scrubUrl(value) : scrubText(value);
      else data[key] = value;
    }
    scrubbed.data = data;
  }
  return scrubbed;
}

export function scrubEvent<T extends ErrorEvent>(event: T): T {
  // Who the user is stays out: the organization is found from the record ids.
  delete event.user;
  delete event.extra;

  if (event.request) {
    event.request = {
      ...(event.request.method ? { method: event.request.method } : {}),
      ...(event.request.url ? { url: scrubUrl(event.request.url) } : {}),
    };
  }
  if (event.message) event.message = scrubText(event.message);
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  // Next.js adds the full request path, query string included, as its own context.
  const nextjs = event.contexts?.nextjs;
  if (nextjs && typeof nextjs.request_path === "string") nextjs.request_path = scrubUrl(nextjs.request_path);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  return event;
}
