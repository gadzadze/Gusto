import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// A one-time sign-in link: never indexed, never cached.
export const metadata: Metadata = { robots: { index: false, follow: false } };

const TYPES = new Set(["email", "magiclink", "signup"]);

export default function ContinuePage(props: PageProps<"/auth/continue">) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8">
        <Logo />
      </Link>
      <Suspense fallback={<Skeleton className="h-48 w-full max-w-sm" />}>
        <Continue {...props} />
      </Suspense>
    </main>
  );
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

async function Continue({ searchParams }: Pick<PageProps<"/auth/continue">, "searchParams">) {
  const t = await getTranslations("authContinue");
  const params = await searchParams;
  const tokenHash = one(params.token_hash);
  const type = one(params.type);
  const valid = tokenHash !== "" && TYPES.has(type);
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{valid ? t("body") : t("invalid")}</CardDescription>
      </CardHeader>
      <CardContent>
        {valid ? (
          // A real form POST: the token is only used when a person presses the button.
          <form method="POST" action="/auth/confirm">
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="type" value={type} />
            <Button type="submit" className="w-full">
              {t("button")}
            </Button>
          </form>
        ) : (
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">{t("toLogin")}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
