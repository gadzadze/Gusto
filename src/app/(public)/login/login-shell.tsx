"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { LocaleSwitch } from "@/components/locale-switch";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** The sign-in page around the form, in the browser so a language change is instant. */
export function LoginShell({ form, demo }: { form: ReactNode; demo: ReactNode }) {
  const t = useTranslations("login");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8">
        <Logo />
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>{form}</CardContent>
      </Card>
      <p className="mt-5 max-w-sm text-center text-xs leading-5 text-muted-foreground">
        {t.rich("legalNote", {
          terms: (chunks) => (
            <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
              {chunks}
            </Link>
          ),
        })}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <LocaleSwitch />
        <ThemeToggle />
      </div>
      {demo}
    </main>
  );
}
