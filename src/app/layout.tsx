import type { Metadata } from "next";
import { Inter, Noto_Sans_Georgian } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
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
const THEME_SCRIPT = `(function(){var p=null;try{p=localStorage.getItem("gusto-theme")}catch(e){}var d=p==="dark"||(p!=="light"&&window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ka" suppressHydrationWarning className={`${inter.variable} ${notoGeorgian.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <NextIntlClientProvider>
          <DemoBanner />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
