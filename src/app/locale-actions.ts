"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { isLocale, LOCALE_COOKIE } from "@/i18n/locales";

/**
 * Saves the visitor's language and re-renders the current page in it. Public on purpose (the
 * landing page and sign-in are in the same boat); it only stores a preference and takes one of
 * two fixed values. Readable by the page script (not httpOnly) so <html lang> follows the choice.
 */
export async function setLocaleAction(next: unknown): Promise<void> {
  if (!isLocale(next)) return;
  (await cookies()).set(LOCALE_COOKIE, next, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  refresh();
}
