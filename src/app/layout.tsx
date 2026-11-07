import type { Metadata } from "next";
import { Inter, Noto_Sans_Georgian } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { Suspense } from "react";
import { LOCALE_COOKIE } from "@/i18n/locales";
import { getMessages, getTranslations } from "next-intl/server";
import { CLIENT_NAMESPACES, pickMessages } from "@/i18n/client-messages";
import { DemoBanner } from "@/components/demo-banner";
import { isDemoMode } from "@/lib/demo";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin", "latin-ext"] });
const notoGeorgian = Noto_Sans_Georgian({
  variable: "--font-noto-georgian",
  subsets: ["georgian"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("title"),
    description: t("description"),
    ...(isDemoMode() ? { robots: { index: false, follow: false } } : {}),
  };
}

// Runs before first paint, so there is no flash: the saved choice, else the device's setting.
// Same idea for the language: the server renders lang="ka" statically, this sets the visitor's real choice.
const LANG_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${LOCALE_COOKIE}=([^;]*)/);if(m&&m[1]==="en")document.documentElement.lang="en"}catch(e){}})()`;

const THEME_SCRIPT = `(function(){var p=null;try{p=localStorage.getItem("gusto-theme")}catch(e){}var d=p==="dark"||(p!=="light"&&window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"})()`;

/** Passes the browser components the texts they use (see i18n/client-messages.ts), in the visitor's language. */
async function IntlProvider({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();
  return <NextIntlClientProvider messages={pickMessages(messages, CLIENT_NAMESPACES)}>{children}</NextIntlClientProvider>;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ka" suppressHydrationWarning className={`${inter.variable} ${notoGeorgian.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LANG_SCRIPT }} />
      </head>
      <body className="min-h-full">
        {/* The language is a cookie, read at request time: everything below streams in. */}
        <Suspense fallback={null}>
          <IntlProvider>
            <DemoBanner />
            {children}
          </IntlProvider>
        </Suspense>
      </body>
    </html>
  );
}
