"use client";

import { useRouter } from "next/navigation";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { CLIENT_NAMESPACES, pickMessages } from "./client-messages";
import { LOCALE_COOKIE, type Locale } from "./locales";

// The language is switched in the browser: both languages' texts live here, the cookie is written
// here, and everything rendered by browser components changes in the same instant, with no
// request to the server. The server is told afterwards (router.refresh) so that the parts it
// renders (page titles, tables, the document title) follow in the background.

type Switch = { locale: Locale; syncing: boolean; switchTo: (next: Locale) => void };
const SwitchContext = createContext<Switch | null>(null);

type Bundle = AbstractIntlMessages;
const loading = new Map<Locale, Promise<Bundle>>();

/** The other language's texts, fetched once (the chunk is only downloaded when this runs). */
function load(locale: Locale): Promise<Bundle> {
  let promise = loading.get(locale);
  if (!promise) {
    promise = (locale === "en" ? import("../../messages/en.json") : import("../../messages/ka.json")).then(
      (module) => pickMessages(module.default as object, CLIENT_NAMESPACES) as Bundle,
    );
    loading.set(locale, promise);
  }
  return promise;
}

function writeCookie(locale: Locale) {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${secure}`;
}

export function ClientIntl({ locale: serverLocale, messages: serverMessages, children }: { locale: Locale; messages: object; children: ReactNode }) {
  const router = useRouter();
  const initial = serverMessages as Bundle;
  const [state, setState] = useState<{ locale: Locale; messages: Bundle }>({ locale: serverLocale, messages: initial });
  const [syncing, startTransition] = useTransition();
  // The language the visitor asked for last: a slow server answer for an earlier click must not undo it.
  const wanted = useRef<Locale>(serverLocale);

  useEffect(() => {
    loading.set(serverLocale, Promise.resolve(serverMessages as Bundle));
    // Quietly fetch the other language while the browser is idle, so the switch is instant.
    const other: Locale = serverLocale === "ka" ? "en" : "ka";
    const prefetch = () => void load(other);
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(prefetch);
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(prefetch, 1500);
    return () => window.clearTimeout(id);
  }, [serverLocale, serverMessages]);

  // The server rendered a page (navigation, refresh): follow it, unless the visitor has already asked for another language.
  useEffect(() => {
    if (wanted.current === serverLocale) setState({ locale: serverLocale, messages: serverMessages as Bundle });
  }, [serverLocale, serverMessages]);

  const switchTo = useCallback(
    (next: Locale) => {
      wanted.current = next;
      writeCookie(next);
      document.documentElement.lang = next;
      void load(next).then((messages) => {
        if (wanted.current === next) setState({ locale: next, messages });
      });
      startTransition(() => router.refresh());
    },
    [router],
  );

  return (
    <SwitchContext.Provider value={{ locale: state.locale, syncing, switchTo }}>
      <NextIntlClientProvider locale={state.locale} messages={state.messages}>
        {children}
      </NextIntlClientProvider>
    </SwitchContext.Provider>
  );
}

export function useLocaleSwitch(): Switch {
  const value = useContext(SwitchContext);
  if (!value) throw new Error("useLocaleSwitch must be used inside ClientIntl");
  return value;
}
