// Browser components only get the texts they use. Sending every message with every page made
// pages (and the refresh that follows a language change) about 60 KB heavier.
// Whenever a component asks useTranslations for a namespace, that namespace belongs here:
// tests/unit/client-messages.test.ts scans the source and fails if one is missing.
export const CLIENT_NAMESPACES = [
  "admin.access",
  "admin.actions",
  "admin.categories",
  "admin.requests",
  "admin.reviewErrors",
  "authContinue",
  "buyer",
  "cart",
  "checkout",
  "common",
  "connections",
  "customers",
  "import",
  "invite",
  "landing",
  "login",
  "nav",
  "notifications.preferences",
  "onboarding",
  "orders",
  "password",
  "pricing",
  "products",
  "regular",
  "settings",
  "supplierInvite",
  "supplierRequest",
  "theme",
  "unitNames",
  "validation",
] as const;

type Tree = { [key: string]: Tree | string | Tree[] | string[] };

/** A copy of `messages` holding only the given namespaces (dot paths such as "landing.nav"). */
export function pickMessages<T extends object>(messages: T, namespaces: readonly string[]): T {
  const out: Tree = {};
  for (const path of namespaces) {
    const keys = path.split(".");
    let from: unknown = messages;
    for (const key of keys) from = (from as Tree | undefined)?.[key];
    if (from === undefined) continue;
    let to = out;
    keys.slice(0, -1).forEach((key) => {
      to = (to[key] ??= {}) as Tree;
    });
    to[keys[keys.length - 1]] = from as Tree;
  }
  return out as T;
}
