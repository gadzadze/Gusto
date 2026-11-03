"use client";

import { NextIntlClientProvider } from "next-intl";
import { RouteError } from "@/components/route-error";
import ka from "../../messages/ka.json";
import "./globals.css";

// Replaces the whole page when the root layout itself fails, so it brings its
// own <html>, styles and just the messages the error state needs.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ka">
      <body className="min-h-full">
        <NextIntlClientProvider locale="ka" messages={{ common: { errorBoundary: ka.common.errorBoundary } }}>
          <main className="px-4 py-16">
            <RouteError error={error} reset={reset} />
          </main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
