import "server-only";
import { cookies } from "next/headers";
import { safeNextPath } from "@/lib/safe-next";

// Where to go after sign-in. Kept in a short-lived cookie rather than in the
// OAuth/magic-link URL, so email templates stay simple. A magic link opened
// in another browser simply lands on the default page.
const NEXT_COOKIE = "gusto_next";

export async function rememberNextPath(input: unknown): Promise<void> {
  const next = safeNextPath(input);
  const store = await cookies();
  if (next) {
    store.set(NEXT_COOKIE, next, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 30,
    });
  } else {
    store.delete(NEXT_COOKIE);
  }
}

export async function takeNextPath(): Promise<string | null> {
  const store = await cookies();
  const next = safeNextPath(store.get(NEXT_COOKIE)?.value);
  store.delete(NEXT_COOKIE);
  return next;
}
