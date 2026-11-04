import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { DemoAccounts } from "@/components/demo-accounts";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { contactEmail } from "@/lib/legal";
import { safeNextPath } from "@/lib/safe-next";
import { LoginForm, type LoginError } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const t = await getTranslations("login");
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
        <CardContent>
          <Suspense fallback={<FormSkeleton />}>
            <LoginFormFromParams searchParams={searchParams} />
          </Suspense>
        </CardContent>
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
      <ThemeToggle className="mt-5" />
      <DemoAccounts />
    </main>
  );
}

async function LoginFormFromParams({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const error: LoginError = params.error === "auth" ? "auth" : params.error === "not_allowed" ? "not_allowed" : null;
  return <LoginForm next={next} error={error} contactEmail={contactEmail()} />;
}

function FormSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
